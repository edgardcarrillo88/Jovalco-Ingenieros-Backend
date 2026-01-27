const multer = require('multer')

console.log("Ejecutando middleware procesamiento de documentos");
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
});

module.exports = upload