function requireUploadSecret(req, res, next) {
  console.log(process.env.UPLOAD_SECRET)
  const expected = process.env.UPLOAD_SECRET;
  const supplied = req.get("x-upload-secret");

  if (!expected) {
    return res.status(500).json({
      error: "UPLOAD_SECRET is not configured"
    });
  }

  if (!supplied || supplied !== expected) {
    return res.status(401).json({
      error: "Invalid upload secret"
    });
  }

  next();
}

module.exports = {
  requireUploadSecret
};