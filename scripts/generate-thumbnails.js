import { readdir, mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLIDES_DIR = path.join(__dirname, "../public/slides");
const THUMBNAILS_DIR = path.join(SLIDES_DIR, "thumbnails");
const METADATA_FILE = path.join(SLIDES_DIR, "metadata.json");

async function generateThumbnails() {
  console.log("📸 PDFサムネイル生成を開始します...");

  // サムネイルディレクトリを作成
  if (!existsSync(THUMBNAILS_DIR)) {
    await mkdir(THUMBNAILS_DIR, { recursive: true });
    console.log("✅ サムネイルディレクトリを作成しました");
  }

  // PDFファイルを取得
  const files = await readdir(SLIDES_DIR);
  const pdfFiles = files.filter((file) => file.endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log("⚠️  PDFファイルが見つかりませんでした");
    return;
  }

  console.log(`📄 ${pdfFiles.length}個のPDFファイルを処理します`);

  const metadata = {};

  for (const filename of pdfFiles) {
    try {
      console.log(`  処理中: ${filename}`);

      const pdfPath = path.join(SLIDES_DIR, filename);
      const name = filename.replace(".pdf", "");
      const thumbnailPath = path.join(THUMBNAILS_DIR, `${name}.png`);

      // PDFを読み込む
      const loadingTask = pdfjsLib.getDocument(pdfPath);
      const pdf = await loadingTask.promise;

      // ページ数を取得
      const numPages = pdf.numPages;

      // 1ページ目を取得
      const page = await pdf.getPage(1);

      // ビューポートを設定（幅350pxに合わせる）
      const viewport = page.getViewport({ scale: 1.0 });
      const scale = 350 / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      // Canvasを作成
      const canvas = createCanvas(scaledViewport.width, scaledViewport.height);
      const context = canvas.getContext("2d");

      // PDFをレンダリング
      const renderContext = {
        canvasContext: context,
        viewport: scaledViewport,
      };

      await page.render(renderContext).promise;

      // PNGとして保存
      const buffer = canvas.toBuffer("image/png");
      await writeFile(thumbnailPath, buffer);

      // メタデータを保存
      metadata[filename] = {
        name,
        filename,
        numPages,
        thumbnail: `/slides/thumbnails/${name}.png`,
      };

      console.log(`    ✅ サムネイル生成完了 (${numPages}ページ)`);
    } catch (error) {
      console.error(`    ❌ エラー: ${filename}`, error.message);
    }
  }

  // メタデータをJSONファイルとして保存
  await writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  console.log(`\n✅ メタデータを保存しました: ${METADATA_FILE}`);
  console.log(`🎉 サムネイル生成が完了しました！`);
}

generateThumbnails().catch((error) => {
  console.error("❌ サムネイル生成中にエラーが発生しました:", error);
  process.exit(1);
});
