const express = require('express');
const datarouter = express.Router()
const datacontroller = require('../../../controllers/v1/comercial/controller');
const UploadExcel =  require('../../../middleware/v1/excelprocess')


//datarouter.post("/createsingledata",UploadExcel.single('file'),datacontroller.LoadSingleData)
datarouter.post("/comercial/createsingledata",datacontroller.LoadSingleData)
datarouter.post("/comercial/updatesingledata",datacontroller.UpdateSingleData)

datarouter.get("/comercial/getclientes",datacontroller.GetClientes)
datarouter.get("/comercial/getespecialidad",datacontroller.GetEspeciialidades)

datarouter.get("/comercial/getpropuestas",datacontroller.GetPropuestas)
datarouter.get("/comercial/getpropuestassingle",datacontroller.GetPropuestasSingle)

datarouter.post("/comercial/processwbs", UploadExcel.single('file'),datacontroller.ProcessCBS)
datarouter.get("/comercial/getwbs",datacontroller.GetCBS)

datarouter.post("/comercial/createAditionalData",datacontroller.CreateAditionalData)



module.exports = datarouter