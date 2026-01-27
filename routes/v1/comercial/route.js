const express = require('express');
const datarouter = express.Router()
const datacontroller = require('../../../controllers/v1/comercial/controller');
const UploadExcel =  require('../../../middleware/v1/excelprocess')


//datarouter.post("/createsingledata",UploadExcel.single('file'),datacontroller.LoadSingleData)
datarouter.post("/comercial/createsingledata",datacontroller.LoadSingleData)
datarouter.get("/comercial/getclientes",datacontroller.GetClientes)
datarouter.get("/comercial/getespecialidad",datacontroller.GetEspeciialidades)
datarouter.get("/comercial/getpropuestas",datacontroller.GetPropuestas)
datarouter.post("/comercial/processwbs", UploadExcel.single('file'),datacontroller.ProcessWBS)


module.exports = datarouter