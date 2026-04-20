const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/v1/proyectos/controller");
const upload = require("../../../middleware/v1/excelprocess");

router.get("/proyectos/projects", controller.getProjects);
router.get("/proyectos/gantt-template", controller.downloadGanttTemplate);
router.get("/proyectos/projects/:pep", controller.getProjectDetail);
router.get("/proyectos/projects/:pep/valuations/template", controller.downloadValuationTemplate);
router.post("/proyectos/projects/:pep/history", controller.addHistoryEntry);
router.post("/proyectos/projects/:pep/activities", controller.addActivity);
router.post("/proyectos/projects/:pep/valuations", controller.createValuation);
router.put("/proyectos/projects/:pep/activities/:activityId", controller.updateActivity);
router.put("/proyectos/projects/:pep/valuations/:valuationId", controller.updateValuation);
router.post("/proyectos/projects/:pep/activities/bulk", upload.single("file"), controller.bulkUploadActivities);
router.post("/proyectos/projects/:pep/valuations/bulk", upload.single("file"), controller.createValuationFromExcel);
router.get("/proyectos/dashboard", controller.getDashboard);

module.exports = router;
