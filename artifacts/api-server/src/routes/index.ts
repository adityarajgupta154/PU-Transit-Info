import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transitRouter from "./transit";
import trackingRouter from "./tracking";
import geoRouter from "./geo";
import busesRouter from "./buses";
import assignmentsRouter from "./assignments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transitRouter);
router.use("/tracking", trackingRouter);
router.use("/geo", geoRouter);
router.use("/buses", busesRouter);
router.use("/assignments", assignmentsRouter);

export default router;
