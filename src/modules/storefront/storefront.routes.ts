import { Router } from "express";
import { storefrontService } from "./storefront.service.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireCustomerAuth } from "../../shared/middleware/customer-auth.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Storefront module routes — mounted at /api/storefront
 * Read-only customer browsing: active stores + their listed, in-stock products.
 */
export const storefrontRouter = Router();

storefrontRouter.use(requireCustomerAuth);

storefrontRouter.get(
  "/stores",
  asyncHandler(async (_req, res) => {
    const data = await storefrontService.listActiveStores();
    res.json({ data });
  }),
);

storefrontRouter.get(
  "/stores/:storeId/products",
  asyncHandler(async (req, res) => {
    const data = await storefrontService.listStoreProducts(routeParam(req.params.storeId, "storeId"));
    res.json({ data });
  }),
);

storefrontRouter.get(
  "/stores/:storeId/products/:skuId",
  asyncHandler(async (req, res) => {
    const product = await storefrontService.getStoreProduct(
      routeParam(req.params.storeId, "storeId"),
      routeParam(req.params.skuId, "skuId"),
    );
    res.json(product);
  }),
);
