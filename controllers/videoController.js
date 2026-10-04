const Busboy = require("busboy");

const { pool } = require("../config/db");
const { createChunkBuffer } = require("../utils/chunkBuffer");

const {
  insertVideoMetadata,
  finalizeVideo,
  getVideoById,
  listVideos,
  deleteVideo,
  getChunksForRange
} = require("../services/videoService");

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

function getChunkSize() {
  const mb = Number(process.env.VIDEO_CHUNK_SIZE_MB || 8);

  if (!Number.isFinite(mb) || mb < 1) {
    return DEFAULT_CHUNK_SIZE;
  }

  return Math.floor(mb * 1024 * 1024);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function parseRange(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return "invalid";
  }

  let start;
  let end;

  if (match[1] === "") {
    const suffixLength = Number(match[2]);

    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return "invalid";
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);

    end =
      match[2] === ""
        ? fileSize - 1
        : Number(match[2]);

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= fileSize
    ) {
      return "invalid";
    }

    end = Math.min(end, fileSize - 1);
  }

  return {
    start,
    end
  };
}

async function uploadVideo(req, res) {
  const client = await pool.connect();

  let inTransaction = false;

  try {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fields: 10
      }
    });

    let title = "";
    let description = "";
    let videoPromise = null;
    let fileSeen = false;

    bb.on("field", (name, value) => {
      if (name === "title") {
        title = value.trim();
      }

      if (name === "description") {
        description = value;
      }
    });

    bb.on("file", (fieldname, file, info) => {
      if (fieldname !== "video") {
        file.resume();
        return;
      }

      if (fileSeen) {
        file.resume();
        return;
      }

      fileSeen = true;

      videoPromise = (async () => {
        const originalFilename =
          info.filename || "video";

        const mimeType =
          info.mimeType ||
          "application/octet-stream";

        const videoId = await insertVideoMetadata(
          client,
          {
            title: title || originalFilename,
            description,
            originalFilename,
            mimeType
          }
        );

        const chunker =
          createChunkBuffer(getChunkSize());

        let fileSize = 0;
        let chunkIndex = 0;
        let byteOffset = 0;

        for await (const data of file) {
          fileSize += data.length;

          const fullChunks = chunker.push(data);

          for (const chunk of fullChunks) {
            const byteStart = byteOffset;
            const byteEnd =
              byteOffset + chunk.length - 1;

            await client.query(
              `INSERT INTO video_chunks
                (
                  video_id,
                  chunk_index,
                  data,
                  byte_start,
                  byte_end
                )
               VALUES ($1, $2, $3, $4, $5)`,
              [
                videoId,
                chunkIndex,
                chunk,
                byteStart,
                byteEnd
              ]
            );

            byteOffset += chunk.length;
            chunkIndex += 1;
          }
        }

        const lastChunk = chunker.flush();

        if (lastChunk) {
          const byteStart = byteOffset;
          const byteEnd =
            byteOffset + lastChunk.length - 1;

          await client.query(
            `INSERT INTO video_chunks
              (
                video_id,
                chunk_index,
                data,
                byte_start,
                byte_end
              )
             VALUES ($1, $2, $3, $4, $5)`,
            [
              videoId,
              chunkIndex,
              lastChunk,
              byteStart,
              byteEnd
            ]
          );

          chunkIndex += 1;
        }

        await finalizeVideo(
          client,
          videoId,
          fileSize,
          chunkIndex
        );

        return videoId;
      })().catch((err) => {
        file.resume();
        throw err;
      });
    });

    const parserFinished = new Promise(
      (resolve, reject) => {
        bb.on("finish", resolve);
        bb.on("error", reject);
      }
    );

    await client.query("BEGIN");

    inTransaction = true;

    req.pipe(bb);

    await parserFinished;

    if (!fileSeen || !videoPromise) {
      throw new Error("No video file was uploaded");
    }

    const videoId = await videoPromise;

    await client.query("COMMIT");

    inTransaction = false;

    res.status(201).json({
      message: "Video uploaded successfully",
      video: await getVideoById(videoId)
    });
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }

    console.error("Upload error:", err);

    if (!res.headersSent) {
      res.status(400).json({
        error:
          err.message ||
          "Video upload failed"
      });
    }
  } finally {
    client.release();
  }
}

async function getVideos(req, res) {
  try {
    const page = parsePositiveInt(
      req.query.page,
      1
    );

    const limit = Math.min(
      parsePositiveInt(req.query.limit, 12),
      100
    );

    const search =
      typeof req.query.search === "string"
        ? req.query.search.trim()
        : "";

    res.json(
      await listVideos({
        search,
        page,
        limit
      })
    );
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to list videos"
    });
  }
}

async function getVideo(req, res) {
  try {
    const id = Number.parseInt(
      req.params.id,
      10
    );

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return res.status(400).json({
        error: "Invalid video id"
      });
    }

    const video = await getVideoById(id);

    if (!video) {
      return res.status(404).json({
        error: "Video not found"
      });
    }

    res.json(video);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to get video"
    });
  }
}

async function streamVideo(req, res) {
  try {
    const id = Number.parseInt(
      req.params.id,
      10
    );

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return res
        .status(400)
        .send("Invalid video id");
    }

    const video = await getVideoById(id);

    if (!video) {
      return res
        .status(404)
        .send("Video not found");
    }

    const fileSize = Number(video.file_size);

    if (
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0
    ) {
      return res
        .status(416)
        .send("Video is empty");
    }

    const range = parseRange(
      req.headers.range,
      fileSize
    );

    if (range === "invalid") {
      res
        .status(416)
        .set(
          "Content-Range",
          `bytes */${fileSize}`
        );

      return res.end();
    }

    const start = range
      ? range.start
      : 0;

    const end = range
      ? range.end
      : fileSize - 1;

    const contentLength =
      end - start + 1;

    const chunkSize = getChunkSize();

    const startChunk = Math.floor(
      start / chunkSize
    );

    const endChunk = Math.floor(
      end / chunkSize
    );

    const result =
      await getChunksForRange(
        id,
        startChunk,
        endChunk
      );

    if (
      result.rows.length !==
      endChunk - startChunk + 1
    ) {
      return res
        .status(500)
        .send("Video data is incomplete");
    }

    res
      .status(range ? 206 : 200)
      .set({
        "Content-Type": video.mime_type,
        "Content-Length":
          String(contentLength),
        "Accept-Ranges": "bytes",
        "Cache-Control":
          "public, max-age=3600"
      });

    if (range) {
      res.set(
        "Content-Range",
        `bytes ${start}-${end}/${fileSize}`
      );
    }

    for (const row of result.rows) {
      const rowStart = Number(
        row.byte_start
      );

      const from = Math.max(
        start - rowStart,
        0
      );

      const to = Math.min(
        end - rowStart,
        row.data.length - 1
      );

      if (to >= from) {
        res.write(
          row.data.subarray(
            from,
            to + 1
          )
        );
      }
    }

    res.end();
  } catch (err) {
    console.error(
      "Streaming error:",
      err
    );

    if (!res.headersSent) {
      res
        .status(500)
        .send("Streaming failed");
    } else {
      res.destroy(err);
    }
  }
}

async function removeVideo(req, res) {
  try {
    const id = Number.parseInt(
      req.params.id,
      10
    );

    if (
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return res.status(400).json({
        error: "Invalid video id"
      });
    }

    const deleted = await deleteVideo(id);

    if (!deleted) {
      return res.status(404).json({
        error: "Video not found"
      });
    }

    res.json({
      message: "Video deleted"
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to delete video"
    });
  }
}

module.exports = {
  uploadVideo,
  getVideos,
  getVideo,
  streamVideo,
  removeVideo
};