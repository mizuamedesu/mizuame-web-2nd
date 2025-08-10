import os
import sys
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Tuple
import frontmatter
import markdown
from bs4 import BeautifulSoup

sys.path.append('/home/user/app/style-bert-vits2')

from r2_utils import check_audio_exists, download_audio, upload_audio
from tts_synthesizer import create_synthesizer
from style_bert_vits2.constants import Languages


class AstroTTSProcessor:
    
    def __init__(self, content_dir: str = "src/content/blog", audio_dir: str = "public/audio"):
        self.content_dir = Path(content_dir)
        self.audio_dir = Path(audio_dir)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            self.synthesizer = create_synthesizer(
                model_dir="/home/user/app/models",
                device="auto"
            )
            print("TTS Synthesizer initialized successfully")
        except Exception as e:
            print(f"Error initializing TTS Synthesizer: {e}")
            self.synthesizer = None
    
    def extract_text_from_markdown(self, md_content: str) -> str:
        html = markdown.markdown(md_content)
        soup = BeautifulSoup(html, 'html.parser')
        text = soup.get_text()
        text = re.sub(r'\n+', '\n', text)
        text = re.sub(r' +', ' ', text)
        text = text.strip()
        return text
    
    def generate_audio_filename(self, content: str, filename: str) -> str:
        content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()[:8]
        base_name = Path(filename).stem
        return f"{base_name}_{content_hash}.wav"
    
    def split_text_for_synthesis(self, text: str, max_length: int = 300) -> List[str]:
        sentences = re.split(r'[。！？\n]', text)
        
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            if len(current_chunk + sentence) > max_length and current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = sentence
            else:
                current_chunk += sentence + "。"
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return [chunk for chunk in chunks if chunk.strip()]
    
    def synthesize_text_chunks(self, chunks: List[str], output_path: str) -> bool:
        if not self.synthesizer:
            print("TTS Synthesizer not available")
            return False
        
        try:
            import numpy as np
            from scipy.io import wavfile
            
            combined_audio = []
            sample_rate = None
            
            for i, chunk in enumerate(chunks):
                print(f"Synthesizing chunk {i+1}/{len(chunks)}: {chunk[:50]}...")
                
                sr, audio = self.synthesizer.synthesize(
                    text=chunk,
                    language=Languages.JP,
                    auto_split=True,
                    split_interval=0.5
                )
                
                if sample_rate is None:
                    sample_rate = sr
                elif sr != sample_rate:
                    print(f"Warning: Sample rate mismatch {sr} vs {sample_rate}")
                
                combined_audio.extend(audio.tolist())
                
                if i < len(chunks) - 1:
                    silence_samples = int(sample_rate * 1.0)
                    combined_audio.extend([0] * silence_samples)
            
            combined_audio_array = np.array(combined_audio, dtype=np.int16)
            wavfile.write(output_path, sample_rate, combined_audio_array)
            
            print(f"Audio saved to: {output_path}")
            return True
            
        except Exception as e:
            print(f"Error during synthesis: {e}")
            return False
    
    def process_blog_post(self, md_file: Path) -> Dict:
        print(f"Processing: {md_file.name}")
        
        try:
            with open(md_file, 'r', encoding='utf-8') as f:
                post = frontmatter.load(f)
            
            metadata = post.metadata
            content = post.content
            
            plain_text = self.extract_text_from_markdown(content)
            
            if not plain_text.strip():
                print(f"No text content found in {md_file.name}")
                return {"status": "skipped", "reason": "no_content"}
            
            audio_filename = self.generate_audio_filename(plain_text, md_file.name)
            audio_path = self.audio_dir / audio_filename
            
            r2_audio_key = f"audio/{audio_filename}"
            
            if check_audio_exists(r2_audio_key):
                print(f"Audio exists in R2, downloading: {audio_filename}")
                if download_audio(r2_audio_key, str(audio_path)):
                    return {
                        "status": "cached",
                        "audio_file": audio_filename,
                        "file_path": str(audio_path)
                    }
            
            print(f"Generating audio for: {md_file.name}")
            
            text_chunks = self.split_text_for_synthesis(plain_text)
            print(f"Split into {len(text_chunks)} chunks")
            
            if self.synthesize_text_chunks(text_chunks, str(audio_path)):
                if upload_audio(str(audio_path), r2_audio_key):
                    return {
                        "status": "generated",
                        "audio_file": audio_filename,
                        "file_path": str(audio_path),
                        "chunks": len(text_chunks)
                    }
                else:
                    return {
                        "status": "upload_failed",
                        "audio_file": audio_filename,
                        "file_path": str(audio_path)
                    }
            else:
                return {"status": "synthesis_failed"}
                
        except Exception as e:
            print(f"Error processing {md_file.name}: {e}")
            return {"status": "error", "error": str(e)}
    
    def process_all_posts(self) -> Dict:
        if not self.content_dir.exists():
            print(f"Content directory not found: {self.content_dir}")
            return {"error": "content_directory_not_found"}
        
        md_files = list(self.content_dir.glob("*.md"))
        if not md_files:
            print("No markdown files found")
            return {"error": "no_markdown_files"}
        
        print(f"Found {len(md_files)} markdown files")
        
        results = {}
        audio_mapping = {}
        successful = 0
        cached = 0
        failed = 0
        
        for md_file in md_files:
            result = self.process_blog_post(md_file)
            results[md_file.name] = result
            
            if result.get("status") in ["generated", "cached"] and result.get("audio_file"):
                article_slug = md_file.stem
                audio_mapping[article_slug] = result["audio_file"]
            
            if result["status"] == "generated":
                successful += 1
            elif result["status"] == "cached":
                cached += 1
            else:
                failed += 1
        
        self.create_audio_mapping_json(audio_mapping)
        
        summary = {
            "total_files": len(md_files),
            "successful": successful,
            "cached": cached,
            "failed": failed,
            "audio_mapping": audio_mapping,
            "results": results
        }
        
        print(f"\nProcessing Summary:")
        print(f"  Total: {summary['total_files']}")
        print(f"  Generated: {summary['successful']}")
        print(f"  Cached: {summary['cached']}")
        print(f"  Failed: {summary['failed']}")
        print(f"  Audio files: {len(audio_mapping)}")
        
        return summary
        
    def create_audio_mapping_json(self, audio_mapping: Dict[str, str]):
        import json
        from datetime import datetime
        
        mapping_data = {
            "generated_at": datetime.now().isoformat(),
            "mapping": audio_mapping,
            "count": len(audio_mapping)
        }
        
        mapping_file = Path("public/audio-mapping.json")
        mapping_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(mapping_file, 'w', encoding='utf-8') as f:
            json.dump(mapping_data, f, ensure_ascii=False, indent=2)
        
        print(f"Audio mapping JSON created: {mapping_file}")
        print(f"Mapped {len(audio_mapping)} articles to audio files")
    
    def get_available_voices(self) -> Dict:
        if not self.synthesizer:
            return {"error": "synthesizer_not_available"}
        
        return {
            "models": self.synthesizer.get_model_names(),
            "speakers": self.synthesizer.get_speakers(),
            "styles": self.synthesizer.get_styles()
        }


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Astro blog TTS processor")
    parser.add_argument("--content-dir", default="src/content/blog", 
                       help="Content directory path")
    parser.add_argument("--audio-dir", default="public/audio", 
                       help="Audio output directory path")
    parser.add_argument("--info", action="store_true", 
                       help="Show available voices info")
    
    args = parser.parse_args()
    
    if os.path.exists("astro.config.mjs"):
        print("Found Astro project in current directory")
    else:
        print("Warning: astro.config.mjs not found. Make sure you're in the Astro project root.")
    
    processor = AstroTTSProcessor(
        content_dir=args.content_dir,
        audio_dir=args.audio_dir
    )
    
    if args.info:
        info = processor.get_available_voices()
        print("Available voices:")
        print(info)
        return
    
    results = processor.process_all_posts()
    
    import json
    print("\n" + "="*50)
    print("RESULTS_JSON:")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()