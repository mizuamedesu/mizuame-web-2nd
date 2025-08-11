import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { createWriteStream } from 'fs';

const BLOG_DIR = 'src/content/blog';
const IMAGE_DIR = 'public/blog-content-img';
const BASE_URL = '/blog-content-img';

// 外部画像URLの正規表現パターン
const IMAGE_URL_PATTERN = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+\.(?:png|jpg|jpeg|gif|webp|svg))\)/gi;

async function downloadImage(url, filename) {
  try {
    console.log(`Downloading: ${url}`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const writer = createWriteStream(path.join(IMAGE_DIR, filename));
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Failed to download ${url}:`, error.message);
    throw error;
  }
}

function generateFilename(url, index) {
  // URLから拡張子を取得
  const urlParts = url.split('.');
  const extension = urlParts[urlParts.length - 1].split('?')[0];
  
  // URLからユニークなハッシュを生成
  const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
  
  return `image-${index + 1}-${hash}.${extension}`;
}

async function processMarkdownFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    let updatedContent = content;
    const imageUrls = [];
    let match;
    
    // 外部画像URLを収集
    const regex = new RegExp(IMAGE_URL_PATTERN.source, 'gi');
    while ((match = regex.exec(content)) !== null) {
      imageUrls.push({
        fullMatch: match[0],
        altText: match[1],
        url: match[2]
      });
    }

    if (imageUrls.length === 0) {
      console.log(`No external images found in ${filePath}`);
      return false;
    }

    console.log(`Found ${imageUrls.length} external images in ${filePath}`);
    let hasChanges = false;

    // 各画像をダウンロードしてパスを更新
    for (let i = 0; i < imageUrls.length; i++) {
      const imageInfo = imageUrls[i];
      const filename = generateFilename(imageInfo.url, i);
      const localPath = path.join(IMAGE_DIR, filename);

      try {
        // ファイルが既に存在するかチェック
        try {
          await fs.access(localPath);
          console.log(`Image already exists: ${filename}`);
        } catch {
          // ファイルが存在しない場合はダウンロード
          await downloadImage(imageInfo.url, filename);
          console.log(`Downloaded: ${filename}`);
        }

        // マークダウン内のURLを更新
        const newImagePath = `![${imageInfo.altText}](${BASE_URL}/${filename})`;
        updatedContent = updatedContent.replace(imageInfo.fullMatch, newImagePath);
        hasChanges = true;

      } catch (error) {
        console.error(`Failed to process image ${imageInfo.url}:`, error.message);
        // 失敗した場合は元のURLを保持
      }
    }

    if (hasChanges) {
      await fs.writeFile(filePath, updatedContent, 'utf-8');
      console.log(`Updated ${filePath}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

async function processAllMarkdownFiles() {
  try {
    const files = await fs.readdir(BLOG_DIR);
    const markdownFiles = files.filter(file => file.endsWith('.md'));
    
    console.log(`Found ${markdownFiles.length} markdown files to process`);
    
    let totalUpdated = 0;
    for (const file of markdownFiles) {
      const filePath = path.join(BLOG_DIR, file);
      const updated = await processMarkdownFile(filePath);
      if (updated) totalUpdated++;
    }

    console.log(`\nProcessing complete. Updated ${totalUpdated} files.`);
    return totalUpdated > 0;
  } catch (error) {
    console.error('Error processing markdown files:', error.message);
    process.exit(1);
  }
}

processAllMarkdownFiles().then(hasChanges => {
  if (hasChanges) {
    console.log('Changes detected. Files have been updated.');
  } else {
    console.log('No changes needed.');
  }
});
