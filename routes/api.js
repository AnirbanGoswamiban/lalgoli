const { Router } = require("express");

const { requireUploadSecret } = require("../middleware/uploadAuth");

const {
  uploadVideo,
  getVideos,
  getVideo,
  streamVideo,
  removeVideo
} = require("../controllers/videoController");

const router = Router();

router.post("/videos", requireUploadSecret, uploadVideo);

router.get("/videos", getVideos);

router.get("/videos/:id", getVideo);

router.get("/videos/:id/stream", streamVideo);

router.delete("/videos/:id", requireUploadSecret, removeVideo);

module.exports = router;