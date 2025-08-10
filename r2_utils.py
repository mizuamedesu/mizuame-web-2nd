import boto3
import os
import sys
from pathlib import Path
from typing import List, Optional
import hashlib


class R2Client:
    def __init__(self):
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("R2_ENDPOINT_URL"),
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name="auto"
        )
        self.bucket = os.environ.get("R2_BUCKET_NAME")
        
        if not all([self.client, self.bucket]):
            raise ValueError("R2 credentials not properly configured")
    
    def download_models(self, target_dir: str = "/home/user/app/models") -> bool:
        print("Downloading TTS models from R2...")
        target_path = Path(target_dir)
        
        try:
            target_path.mkdir(parents=True, exist_ok=True, mode=0o755)
        except PermissionError:
            print(f"Permission denied creating {target_path}, trying current directory...")
            target_path = Path("./models")
            target_path.mkdir(parents=True, exist_ok=True, mode=0o755)
        
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket, 
                Prefix="models/"
            )
            
            if "Contents" not in response:
                print("No models found in R2")
                return False
                
            downloaded_count = 0
            for obj in response["Contents"]:
                key = obj["Key"]
                relative_path = key.replace("models/", "", 1)
                local_path = target_path / relative_path
                local_path.parent.mkdir(parents=True, exist_ok=True)
                
                print(f"Downloading {key} -> {local_path}")
                self.client.download_file(self.bucket, key, str(local_path))
                downloaded_count += 1
                
            print(f"Successfully downloaded {downloaded_count} model files")
            return True
            
        except Exception as e:
            print(f"Error downloading models: {e}")
            return False
    
    def upload_audio(self, local_path: str, audio_filename: str) -> bool:
        s3_key = f"audio/{audio_filename}"
        
        try:
            self.client.upload_file(local_path, self.bucket, s3_key)
            print(f"Uploaded {local_path} to {s3_key}")
            return True
        except Exception as e:
            print(f"Error uploading {local_path}: {e}")
            return False
    
    def check_audio_exists(self, audio_filename: str) -> bool:
        s3_key = f"audio/{audio_filename}"
        
        try:
            self.client.head_object(Bucket=self.bucket, Key=s3_key)
            return True
        except:
            return False
    
    def download_audio(self, audio_filename: str, local_path: str) -> bool:
        s3_key = f"audio/{audio_filename}"
        
        try:
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            self.client.download_file(self.bucket, s3_key, local_path)
            print(f"Downloaded {s3_key} to {local_path}")
            return True
        except Exception as e:
            print(f"Error downloading {s3_key}: {e}")
            return False
    
    def list_models(self) -> List[str]:
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket,
                Prefix="models/"
            )
            
            if "Contents" not in response:
                return []
            
            return [obj["Key"] for obj in response["Contents"]]
        
        except Exception as e:
            print(f"Error listing models: {e}")
            return []
    
    def list_audio_files(self) -> List[str]:
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket,
                Prefix="audio/"
            )
            
            if "Contents" not in response:
                return []
            
            return [
                obj["Key"].replace("audio/", "", 1) 
                for obj in response["Contents"]
                if obj["Key"] != "audio/"
            ]
        
        except Exception as e:
            print(f"Error listing audio files: {e}")
            return []


def setup_r2_client():
    return R2Client().client


def download_models():
    try:
        client = R2Client()
        return client.download_models()
    except Exception as e:
        print(f"Error: {e}")
        return False


def upload_audio(local_path: str, s3_key: str):
    try:
        client = R2Client()
        filename = s3_key.replace("audio/", "", 1)
        return client.upload_audio(local_path, filename)
    except Exception as e:
        print(f"Error: {e}")
        return False


def check_audio_exists(s3_key: str):
    try:
        client = R2Client()
        filename = s3_key.replace("audio/", "", 1)
        return client.check_audio_exists(filename)
    except Exception as e:
        print(f"Error: {e}")
        return False


def download_audio(s3_key: str, local_path: str):
    try:
        client = R2Client()
        filename = s3_key.replace("audio/", "", 1)
        return client.download_audio(filename, local_path)
    except Exception as e:
        print(f"Error: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python r2_utils.py <command>")
        print("Commands:")
        print("  download-models    - Download TTS models from R2")
        print("  list-models        - List available models in R2")
        print("  list-audio         - List audio files in R2")
        sys.exit(1)
    
    command = sys.argv[1]
    
    try:
        client = R2Client()
        
        if command == "download-models":
            success = client.download_models()
            sys.exit(0 if success else 1)
            
        elif command == "list-models":
            models = client.list_models()
            print(f"Found {len(models)} model files:")
            for model in models:
                print(f"  {model}")
                
        elif command == "list-audio":
            audio_files = client.list_audio_files()
            print(f"Found {len(audio_files)} audio files:")
            for audio in audio_files:
                print(f"  {audio}")
                
        else:
            print(f"Unknown command: {command}")
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()