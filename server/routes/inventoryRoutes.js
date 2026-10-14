import { Router } from "express";
import { create, list, patch, remove } from "../controllers/inventoryController.js";

export const inventoryRouter = Router({ mergeParams: true });

inventoryRouter.get("/", list);
inventoryRouter.post("/", create);
inventoryRouter.patch("/:inventoryId", patch);
inventoryRouter.delete("/:inventoryId", remove);
