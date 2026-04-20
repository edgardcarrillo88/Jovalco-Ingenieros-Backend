const express = require("express");
const router = express.Router();
const controller = require("../../../controllers/v1/proyectos/controller");
const upload = require("../../../middleware/v1/excelprocess");

router.get("/proyectos/projects", controller.getProjects);
router.get("/proyectos/gantt-template", controller.downloadGanttTemplate);
router.get("/proyectos/projects/:pep", controller.getProjectDetail);
router.post("/proyectos/projects/:pep/history", controller.addHistoryEntry);
router.post("/proyectos/projects/:pep/activities", controller.addActivity);
router.put("/proyectos/projects/:pep/activities/:activityId", controller.updateActivity);
router.post("/proyectos/projects/:pep/activities/bulk", upload.single("file"), controller.bulkUploadActivities);
router.get("/proyectos/dashboard", controller.getDashboard);

module.exports = router;
