const { Router } = require("express");
const { getVideoById } = require("../services/videoService");

const router = Router();

router.get("/", (req, res) => {
  res.redirect("/videos");
});

router.get("/videos", (req, res) => {
  res.render("videos", {
    search: req.query.search || ""
  });
});

router.get("/upload", (req, res) => {
  res.render("upload");
});

router.get("/watch/:id", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).send("Invalid video id");
    }

    const video = await getVideoById(id);

    if (!video) {
      return res.status(404).send("Video not found");
    }

    res.render("watch", { video });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to load video");
  }
});

module.exports = router;

