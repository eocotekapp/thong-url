import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import cloudinary from "cloudinary";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || null,
    hasApiKey: Boolean(process.env.CLOUDINARY_API_KEY),
    hasApiSecret: Boolean(process.env.CLOUDINARY_API_SECRET)
  });
});

app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Chưa chọn video"
      });
    }

    const expireMinutes = Number(req.body.expireMinutes || 30);
    const expiresAt = Math.floor(Date.now() / 1000) + expireMinutes * 60;

    const result = await cloudinary.v2.uploader.upload(req.file.path, {
      resource_type: "video",
      folder: "videos",
      type: "authenticated",
      access_mode: "authenticated",
      use_filename: true,
      unique_filename: true,
      overwrite: false
    });

    const publicId = result.public_id;
    const format = result.format || "mp4";

    const directUrl = cloudinary.v2.url(publicId, {
      resource_type: "video",
      type: "authenticated",
      format,
      sign_url: true,
      expires_at: expiresAt
    });

    const previewUrl = cloudinary.v2.url(publicId, {
      resource_type: "video",
      type: "authenticated",
      format,
      sign_url: true,
      expires_at: expiresAt,
      secure: true
    });

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.json({
      success: true,
      fileName: result.original_filename,
      publicId,
      format,
      bytes: result.bytes,
      expiresInMinutes: expireMinutes,
      directUrl,
      previewUrl
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
  console.log(`Server chạy tại cổng ${PORT}`);
});