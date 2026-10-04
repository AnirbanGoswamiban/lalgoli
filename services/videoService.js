const { pool } = require("../config/db");

async function insertVideoMetadata(client, metadata) {
  const result = await client.query(
    `INSERT INTO videos
      (title, description, original_filename, mime_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      metadata.title,
      metadata.description,
      metadata.originalFilename,
      metadata.mimeType
    ]
  );

  return result.rows[0].id;
}

async function finalizeVideo(
  client,
  videoId,
  fileSize,
  totalChunks
) {
  await client.query(
    `UPDATE videos
     SET file_size = $1,
         total_chunks = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [
      fileSize,
      totalChunks,
      videoId
    ]
  );
}

async function getVideoById(id) {
  const result = await pool.query(
    `SELECT
       id,
       title,
       description,
       original_filename,
       mime_type,
       file_size,
       total_chunks,
       created_at,
       updated_at
     FROM videos
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function listVideos({
  search,
  page,
  limit
}) {
  const offset = (page - 1) * limit;

  const params = [];
  let where = "";

  if (search) {
    params.push(`%${search}%`);

    where = `WHERE title ILIKE $${params.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::bigint AS total
     FROM videos
     ${where}`,
    params
  );

  params.push(limit);
  params.push(offset);

  const result = await pool.query(
    `SELECT
       id,
       title,
       description,
       original_filename,
       mime_type,
       file_size,
       total_chunks,
       created_at
     FROM videos
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  const total = Number(
    countResult.rows[0].total
  );

  return {
    items: result.rows,

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(
        total / limit
      )
    }
  };
}

async function deleteVideo(id) {
  const result = await pool.query(
    `DELETE FROM videos
     WHERE id = $1
     RETURNING id`,
    [id]
  );

  return result.rowCount > 0;
}

async function getChunksForRange(
  videoId,
  startChunk,
  endChunk
) {
  return pool.query(
    `SELECT
       chunk_index,
       data,
       byte_start,
       byte_end
     FROM video_chunks
     WHERE video_id = $1
       AND chunk_index BETWEEN $2 AND $3
     ORDER BY chunk_index ASC`,
    [
      videoId,
      startChunk,
      endChunk
    ]
  );
}

module.exports = {
  insertVideoMetadata,
  finalizeVideo,
  getVideoById,
  listVideos,
  deleteVideo,
  getChunksForRange
};
