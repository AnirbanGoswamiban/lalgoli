const express = require("express");
const path = require("path");

const apiRouter = require("./routes/api");
const pageRouter = require("./routes/pages");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", apiRouter);
app.use("/", pageRouter);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "Not found"
    });
  }

  res.status(404).send("Not found");
});

module.exports = app;