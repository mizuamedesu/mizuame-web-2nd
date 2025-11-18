import { readdir, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pdf } from "pdf-to-img";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLIDES_DIR = path.join(__dirname, "../public/slides");
const THUMBNAILS_DIR = path.join(SLIDES_DIR, "thumbnails");
const METADATA_FILE = path.join(SLIDES_DIR, "metadata.json");

async function generateThumbnails() {
  console.log("PDFサムネイル生成を開始します...");

  if (!existsSync(THUMBNAILS_DIR)) {
    await mkdir(THUMBNAILS_DIR, { recursive: true });
    console.log("サムネイルディレクトリを作成しました");
  }

  const files = await readdir(SLIDES_DIR);
  const pdfFiles = files.filter((file) => file.endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log("PDFファイルが見つかりませんでした");
    return;
  }

  console.log(`${pdfFiles.length}個のPDFファイルを処理します`);

  const metadata = {};

  for (const filename of pdfFiles) {
    try {
      console.log(`  処理中: ${filename}`);

      const pdfPath = path.join(SLIDES_DIR, filename);
      const name = filename.replace(".pdf", "");
      const thumbnailPath = path.join(THUMBNAILS_DIR, `${name}.png`);

      // PDFを画像に変換（幅350pxに設定）
      const document = await pdf(pdfPath, { scale: 2.0 });

      let numPages = 0;
      let firstPageSaved = false;

      // 最初のページのみを保存
      for await (const image of document) {
        numPages++;
        if (!firstPageSaved) {
          await writeFile(thumbnailPath, image);
          firstPageSaved = true;
          console.log(`    サムネイル生成完了 (${numPages}ページ目)`);
        }
      }

      metadata[filename] = {
        name,
        filename,
        numPages,
        thumbnail: `/slides/thumbnails/${name}.png`,
      };

      console.log(`    完了: 全${numPages}ページ`);
    } catch (error) {
      console.error(`    エラー: ${filename}`, error.message);
    }
  }

  await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\nメタデータを保存しました: ${METADATA_FILE}`);
  console.log("サムネイル生成が完了しました");
}

generateThumbnails().catch((error) => {
  console.error("サムネイル生成中にエラーが発生しました:", error);
  process.exit(1);
});
