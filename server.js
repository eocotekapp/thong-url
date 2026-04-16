import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import axios from "axios";
import FormData from "form-data";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const TELEBOX_TOKEN = process.env.TELEBOX_TOKEN || "";
const PORT = process.env.PORT || 3000;

function extractUrls(text) {
  if (!text) return [];

  const patterns = [
    /https?:\/\/[^\s"'<>]+\.(?:mp4|mov|m4v|webm|mkv|avi|flv|ts|m3u8)(?:\?[^\s"'<>]*)?/gi,
    /https?:\/\/[^\s"'<>]+(?:token=|ht=video\/|filename=)[^\s"'<>]*/gi,
    /https?:\/\/www\.telebox\.online\/f-detail\/[^\s"'<>]+/gi,
    /https?:\/\/[^\s"'<>]+\/s\/[^\s"'<>]+/gi
  ];

  const found = [];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (!found.includes(match)) {
          found.push(match);
        }
      }
    }
  }

  return found;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(TELEBOX_TOKEN),
    port: PORT
  });
});

app.post("/api/resolve", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "Thiếu URL"
      });
    }

    const response = await axios.get(url, {
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const html =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);

    const urls = extractUrls(html);

    return res.json({
      success: true,
      inputUrl: url,
      finalUrl: response.request?.res?.responseUrl || url,
      candidates: urls,
      htmlPreview: html.slice(0, 5000)
    });
  } catch (error) {
    console.error("RESOLVE ERROR:");
    console.error("message:", error.message);
    console.error("status:", error.response?.status);
    console.error("data:", error.response?.data);

    return res.status(500).json({
      success: false,
      message: error.message,
      status: error.response?.status || null,
      responseData: error.response?.data || null
    });
  }
});

app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Chưa chọn video"
      });
    }

    if (!TELEBOX_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "Thiếu TELEBOX_TOKEN trong .env"
      });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const folderName = req.body.folderName || "Cloud Server";
    const expire = req.body.expire || "24h";

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), originalName);
    form.append("folderName", folderName);
    form.append("expire", expire);

    const uploadResponse = await axios.post(
      "https://www.telebox.online/api/upload",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${TELEBOX_TOKEN}`,
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.telebox.online",
          Referer: "https://www.telebox.online/",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const result = uploadResponse.data || {};
    const rawText = JSON.stringify(result);
    const urls = extractUrls(rawText);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return res.json({
      success: true,
      fileName: originalName,
      folderName,
      expire,
      raw: result,
      shareUrl: result.shareUrl || result.share_url || null,
      viewUrl: result.viewUrl || result.view_url || null,
      downloadUrl: result.downloadUrl || result.download_url || null,
      directUrl: result.directUrl || result.direct_url || null,
      candidates: urls
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("UPLOAD ERROR:");
    console.error("message:", error.message);
    console.error("status:", error.response?.status);
    console.error("data:", error.response?.data);
    console.error("headers:", error.response?.headers);

    return res.status(500).json({
      success: false,
      message: error.message,
      status: error.response?.status || null,
      responseData: error.response?.data || null,
      responseHeaders: error.response?.headers || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});