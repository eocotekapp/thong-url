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
    /https?:\/\/www\.telebox\.online\/f-detail\/[^\s"'<>]+/gi
  ];

  const found = [];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (!found.includes(match)) found.push(match);
      }
    }
  }

  return found;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1"
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
      htmlPreview: html.slice(0, 3000)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      response: error.response?.data || null
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

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), originalName);

    const uploadResponse = await axios.post(
      "https://www.telebox.online/api/upload",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${TELEBOX_TOKEN}`
        },
        maxBodyLength: Infinity
      }
    );

    const result = uploadResponse.data || {};
    const rawText = JSON.stringify(result);
    const urls = extractUrls(rawText);

    fs.unlinkSync(filePath);

    return res.json({
      success: true,
      fileName: originalName,
      raw: result,
      shareUrl: result.shareUrl || null,
      viewUrl: result.viewUrl || null,
      downloadUrl: result.downloadUrl || null,
      directUrl: result.directUrl || null,
      candidates: urls
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(500).json({
      success: false,
      message: error.message,
      response: error.response?.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});