import { normalizeHttpUrl } from "../../shared/utils/http-url.js";

const DEFAULT_API_VERSION = "2025-01";

export type ShopifyGraphqlError = {
  message: string;
  field?: string[];
};

export type ShopifyCredentials = {
  shop: string;
  accessToken: string;
  apiVersion?: string;
};

function apiVersion(creds: ShopifyCredentials): string {
  return creds.apiVersion ?? DEFAULT_API_VERSION;
}

export async function shopifyGraphql<T>(
  creds: ShopifyCredentials,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(
    `https://${creds.shop}/admin/api/${apiVersion(creds)}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error(
        "Shopify access token is invalid or expired — open the Quick Commerce app in Shopify admin once to refresh it, then retry sync",
      );
    }
    throw new Error(`Shopify HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }

  return json.data;
}

function userErrors(errors: ShopifyGraphqlError[] | undefined, action: string) {
  if (!errors?.length) return;
  throw new Error(
    `Shopify ${action} failed: ${errors.map((e) => e.message).join("; ")}`,
  );
}

export type ShopifyProductResult = {
  productId: string;
  variantId: string;
  inventoryItemId: string;
};

function buildVariantBulkInput(input: {
  id: string;
  price: string;
  sku?: string | null;
  barcode?: string | null;
  allowBackorder?: boolean;
}): Record<string, unknown> {
  const variant: Record<string, unknown> = {
    id: input.id,
    price: input.price,
    // Dark-store is source of truth — always track quantity in Shopify.
    inventoryPolicy: input.allowBackorder ? "CONTINUE" : "DENY",
    inventoryItem: {
      tracked: true,
      ...(input.sku ? { sku: input.sku } : {}),
    },
  };

  if (input.barcode) {
    variant.barcode = input.barcode;
  }

  return variant;
}

export async function createShopifyProduct(
  creds: ShopifyCredentials,
  input: {
    title: string;
    descriptionHtml?: string | null;
    vendor?: string | null;
    productType?: string | null;
    status: "ACTIVE" | "DRAFT" | "ARCHIVED";
    price: string;
    sku?: string | null;
    barcode?: string | null;
    currencyCode?: string;
    allowBackorder?: boolean;
  },
): Promise<ShopifyProductResult> {
  const data = await shopifyGraphql<{
    productCreate: {
      product: {
        id: string;
        variants: { nodes: Array<{ id: string }> };
      } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation productCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) {
              nodes { id }
            }
          }
          userErrors { field message }
        }
      }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? "",
        vendor: input.vendor ?? undefined,
        productType: input.productType ?? undefined,
        status: input.status,
        tags: ["quick-commerce"],
      },
    },
  );

  userErrors(data.productCreate.userErrors, "productCreate");
  const product = data.productCreate.product;
  const variantId = product?.variants.nodes[0]?.id;
  if (!product?.id || !variantId) {
    throw new Error("Shopify productCreate returned no product/variant id");
  }

  const variantData = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{
        id: string;
        inventoryItem: { id: string } | null;
      }>;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            inventoryItem { id }
          }
          userErrors { field message }
        }
      }`,
    {
      productId: product.id,
      variants: [buildVariantBulkInput({
        id: variantId,
        price: input.price,
        sku: input.sku,
        barcode: input.barcode,
        allowBackorder: input.allowBackorder,
      })],
    },
  );

  userErrors(variantData.productVariantsBulkUpdate.userErrors, "productVariantsBulkUpdate");
  const inventoryItemId =
    variantData.productVariantsBulkUpdate.productVariants[0]?.inventoryItem?.id;
  if (!inventoryItemId) {
    throw new Error("Shopify productVariantsBulkUpdate returned no inventoryItem id");
  }

  return { productId: product.id, variantId, inventoryItemId };
}

export async function updateShopifyProduct(
  creds: ShopifyCredentials,
  input: {
    productId: string;
    variantId: string;
    title: string;
    descriptionHtml?: string | null;
    vendor?: string | null;
    productType?: string | null;
    status: "ACTIVE" | "DRAFT" | "ARCHIVED";
    price: string;
    sku?: string | null;
    barcode?: string | null;
    allowBackorder?: boolean;
  },
): Promise<ShopifyProductResult> {
  const data = await shopifyGraphql<{
    productUpdate: {
      product: { id: string } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id }
          userErrors { field message }
        }
      }`,
    {
      product: {
        id: input.productId,
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? "",
        vendor: input.vendor ?? undefined,
        productType: input.productType ?? undefined,
        status: input.status,
        tags: ["quick-commerce"],
      },
    },
  );

  userErrors(data.productUpdate.userErrors, "productUpdate");

  const variantData = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{
        id: string;
        inventoryItem: { id: string } | null;
      }>;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            inventoryItem { id }
          }
          userErrors { field message }
        }
      }`,
    {
      productId: input.productId,
      variants: [buildVariantBulkInput({
        id: input.variantId,
        price: input.price,
        sku: input.sku,
        barcode: input.barcode,
        allowBackorder: input.allowBackorder,
      })],
    },
  );

  userErrors(variantData.productVariantsBulkUpdate.userErrors, "productVariantsBulkUpdate");
  const inventoryItemId =
    variantData.productVariantsBulkUpdate.productVariants[0]?.inventoryItem?.id;
  if (!inventoryItemId) {
    throw new Error("Shopify productVariantsBulkUpdate returned no inventoryItem id");
  }

  return { productId: input.productId, variantId: input.variantId, inventoryItemId };
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function mimeFromFilename(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "image/jpeg";
}

/**
 * Upload local/remote product images into Shopify Media (not description HTML).
 * Localhost URLs are staged from disk because Shopify cannot fetch them.
 */
export async function syncShopifyProductMedia(
  creds: ShopifyCredentials,
  input: {
    productId: string;
    /** Absolute or /uploads/... URLs from master_catalog.images */
    imageUrls: string[];
    alt?: string;
    /** Absolute path to dark-store-api uploads directory */
    uploadsDir: string;
  },
): Promise<void> {
  const sources = input.imageUrls.map((u) => u.trim()).filter(Boolean);
  if (sources.length === 0) return;

  // Replace existing media so re-sync stays idempotent.
  const existing = await shopifyGraphql<{
    product: {
      media: { nodes: Array<{ id: string }> };
    } | null;
  }>(
    creds,
    `#graphql
      query productMedia($id: ID!) {
        product(id: $id) {
          media(first: 25) {
            nodes { id }
          }
        }
      }`,
    { id: input.productId },
  );

  const existingIds = existing.product?.media.nodes.map((n) => n.id) ?? [];
  if (existingIds.length > 0) {
    const del = await shopifyGraphql<{
      productDeleteMedia: {
        deletedMediaIds: string[] | null;
        mediaUserErrors: ShopifyGraphqlError[];
      };
    }>(
      creds,
      `#graphql
        mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            mediaUserErrors { field message }
          }
        }`,
      { productId: input.productId, mediaIds: existingIds },
    );
    userErrors(del.productDeleteMedia.mediaUserErrors, "productDeleteMedia");
  }

  const mediaInputs: Array<{
    originalSource: string;
    mediaContentType: "IMAGE";
    alt?: string;
  }> = [];

  for (const source of sources) {
    const staged = await resolveImageOriginalSource(creds, source, input.uploadsDir);
    if (!staged) {
      console.warn(`[SHOPIFY_SYNC] Skipping unreachable image: ${source}`);
      continue;
    }
    mediaInputs.push({
      originalSource: staged,
      mediaContentType: "IMAGE",
      alt: input.alt,
    });
  }

  if (mediaInputs.length === 0) return;

  const created = await shopifyGraphql<{
    productCreateMedia: {
      media: Array<{ id: string; status: string }> | null;
      mediaUserErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { id status }
          mediaUserErrors { field message }
        }
      }`,
    {
      productId: input.productId,
      media: mediaInputs,
    },
  );
  userErrors(created.productCreateMedia.mediaUserErrors, "productCreateMedia");
}

async function resolveImageOriginalSource(
  creds: ShopifyCredentials,
  sourceUrl: string,
  uploadsDir: string,
): Promise<string | null> {
  const localPath = resolveLocalUploadPath(sourceUrl, uploadsDir);
  if (localPath) {
    return stagedUploadLocalFile(creds, localPath);
  }

  // Shopify's servers must be able to fetch this URL (no localhost).
  if (!isPubliclyReachableUrl(sourceUrl)) {
    return null;
  }
  return sourceUrl;
}

function resolveLocalUploadPath(sourceUrl: string, uploadsDir: string): string | null {
  try {
    if (sourceUrl.startsWith("/uploads/")) {
      return pathJoin(uploadsDir, sourceUrl.slice("/uploads/".length));
    }
    const u = new URL(sourceUrl);
    if (
      (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
      u.pathname.startsWith("/uploads/")
    ) {
      return pathJoin(uploadsDir, u.pathname.slice("/uploads/".length));
    }
  } catch {
    // not a URL — ignore
  }
  return null;
}

function pathJoin(dir: string, file: string): string {
  const cleaned = file.replace(/^\/+/, "").replace(/\.\./g, "");
  return `${dir.replace(/\/$/, "")}/${cleaned}`;
}

function isPubliclyReachableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

async function stagedUploadLocalFile(
  creds: ShopifyCredentials,
  filePath: string,
): Promise<string | null> {
  const { readFile, stat } = await import("node:fs/promises");
  const { basename } = await import("node:path");

  let fileSize: number;
  try {
    fileSize = (await stat(filePath)).size;
  } catch {
    console.warn(`[SHOPIFY_SYNC] Local image missing: ${filePath}`);
    return null;
  }

  const filename = basename(filePath);
  const mimeType = mimeFromFilename(filename);

  const staged = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }> | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }`,
    {
      input: [
        {
          filename,
          mimeType,
          httpMethod: "POST",
          resource: "PRODUCT_IMAGE",
          fileSize: String(fileSize),
        },
      ],
    },
  );
  userErrors(staged.stagedUploadsCreate.userErrors, "stagedUploadsCreate");
  const target = staged.stagedUploadsCreate.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new Error("Shopify stagedUploadsCreate returned no target");
  }

  const bytes = await readFile(filePath);
  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Shopify staged file upload HTTP ${uploadRes.status}: ${text.slice(0, 200)}`);
  }

  return target.resourceUrl;
}

/** Resolve the Online Store publication GID (sales channel). */
export async function getOnlineStorePublicationId(
  creds: ShopifyCredentials,
): Promise<string> {
  const data = await shopifyGraphql<{
    publications: {
      nodes: Array<{ id: string; name: string }>;
    };
  }>(
    creds,
    `#graphql
      query publications {
        publications(first: 25) {
          nodes { id name }
        }
      }`,
  );

  const pubs = data.publications.nodes;
  const onlineStore =
    pubs.find((p) => p.name.toLowerCase() === "online store") ??
    pubs.find((p) => p.name.toLowerCase().includes("online store"));

  if (!onlineStore?.id) {
    throw new Error(
      `Shopify Online Store publication not found (have: ${pubs.map((p) => p.name).join(", ") || "none"})`,
    );
  }
  return onlineStore.id;
}

/** Publish a product to Online Store so Channels shows at least 1. */
export async function publishProductToOnlineStore(
  creds: ShopifyCredentials,
  input: {
    productId: string;
    publicationId: string;
  },
): Promise<void> {
  const data = await shopifyGraphql<{
    publishablePublish: {
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
    {
      id: input.productId,
      input: [{ publicationId: input.publicationId }],
    },
  );

  userErrors(data.publishablePublish.userErrors, "publishablePublish");
}

/** Primary (first active) Shopify location — used as the single stock mirror target. */
export async function getPrimaryShopifyLocationId(
  creds: ShopifyCredentials,
): Promise<string> {
  const data = await shopifyGraphql<{
    locations: {
      nodes: Array<{ id: string; name: string; isActive: boolean }>;
    };
  }>(
    creds,
    `#graphql
      query primaryLocation {
        locations(first: 10, includeInactive: false) {
          nodes { id name isActive }
        }
      }`,
  );

  const location = data.locations.nodes.find((l) => l.isActive) ?? data.locations.nodes[0];
  if (!location?.id) {
    throw new Error("Shopify store has no locations to stock inventory");
  }
  return location.id;
}

export async function getVariantInventoryItemId(
  creds: ShopifyCredentials,
  variantId: string,
): Promise<string> {
  const data = await shopifyGraphql<{
    productVariant: { id: string; inventoryItem: { id: string } | null } | null;
  }>(
    creds,
    `#graphql
      query variantInventoryItem($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryItem { id }
        }
      }`,
    { id: variantId },
  );

  const inventoryItemId = data.productVariant?.inventoryItem?.id;
  if (!inventoryItemId) {
    throw new Error(`Shopify variant ${variantId} has no inventoryItem`);
  }
  return inventoryItemId;
}

/**
 * Enable tracking (if needed), activate at location on first sync, then set absolute qty.
 * Dark-store aggregated stock is the source of truth.
 */
export async function setShopifyInventoryQuantity(
  creds: ShopifyCredentials,
  input: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    referenceUri?: string;
  },
): Promise<void> {
  const quantity = Math.max(0, Math.floor(input.quantity));

  // Ensure the inventory item is tracked (covers products created before this fix).
  const trackData = await shopifyGraphql<{
    inventoryItemUpdate: {
      inventoryItem: { id: string; tracked: boolean } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
        inventoryItemUpdate(id: $id, input: $input) {
          inventoryItem { id tracked }
          userErrors { field message }
        }
      }`,
    {
      id: input.inventoryItemId,
      input: { tracked: true },
    },
  );
  userErrors(trackData.inventoryItemUpdate.userErrors, "inventoryItemUpdate");

  const levelData = await shopifyGraphql<{
    inventoryItem: {
      id: string;
      inventoryLevels: {
        nodes: Array<{ id: string; location: { id: string } }>;
      };
    } | null;
  }>(
    creds,
    `#graphql
      query inventoryLevels($id: ID!) {
        inventoryItem(id: $id) {
          id
          inventoryLevels(first: 20) {
            nodes {
              id
              location { id }
            }
          }
        }
      }`,
    { id: input.inventoryItemId },
  );

  const alreadyActive = (levelData.inventoryItem?.inventoryLevels.nodes ?? []).some(
    (level) => level.location.id === input.locationId,
  );

  if (!alreadyActive) {
    const activateData = await shopifyGraphql<{
      inventoryActivate: {
        inventoryLevel: { id: string } | null;
        userErrors: ShopifyGraphqlError[];
      };
    }>(
      creds,
      `#graphql
        mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
          inventoryActivate(
            inventoryItemId: $inventoryItemId
            locationId: $locationId
            available: $available
          ) {
            inventoryLevel { id }
            userErrors { field message }
          }
        }`,
      {
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        available: quantity,
      },
    );
    userErrors(activateData.inventoryActivate.userErrors, "inventoryActivate");
    return;
  }

  const setData = await shopifyGraphql<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { createdAt: string } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          inventoryAdjustmentGroup { createdAt }
          userErrors { field message }
        }
      }`,
    {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        ...(input.referenceUri ? { referenceDocumentUri: input.referenceUri } : {}),
        quantities: [
          {
            inventoryItemId: input.inventoryItemId,
            locationId: input.locationId,
            quantity,
            compareQuantity: null,
          },
        ],
      },
    },
  );
  userErrors(setData.inventorySetQuantities.userErrors, "inventorySetQuantities");
}

export type ShopifyOrderResult = {
  orderId: string;
  orderName: string;
};

async function fetchShopCurrency(creds: ShopifyCredentials): Promise<string> {
  const data = await shopifyGraphql<{
    shop: { currencyCode: string };
  }>(
    creds,
    `#graphql
      query shopCurrency {
        shop {
          currencyCode
        }
      }`,
  );

  return data.shop.currencyCode;
}

export async function createShopifyOrder(
  creds: ShopifyCredentials,
  input: {
    email: string;
    phone?: string | null;
    lineItems: Array<{ variantId: string; quantity: number }>;
    shippingAddress: {
      address1: string;
      address2?: string;
      city: string;
      zip: string;
      phone?: string;
      countryCode?: string;
    };
    totalAmount: string;
    note?: string;
  },
): Promise<ShopifyOrderResult> {
  const currencyCode = await fetchShopCurrency(creds);

  const data = await shopifyGraphql<{
    orderCreate: {
      order: { id: string; name: string } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order {
            id
            name
          }
          userErrors { field message }
        }
      }`,
    {
      order: {
        email: input.email,
        phone: input.phone ?? undefined,
        lineItems: input.lineItems.map((li) => ({
          variantId: li.variantId,
          quantity: li.quantity,
        })),
        shippingAddress: {
          address1: input.shippingAddress.address1,
          address2: input.shippingAddress.address2,
          city: input.shippingAddress.city,
          zip: input.shippingAddress.zip,
          phone: input.shippingAddress.phone,
          countryCode: input.shippingAddress.countryCode ?? "IN",
        },
        billingAddress: {
          address1: input.shippingAddress.address1,
          address2: input.shippingAddress.address2,
          city: input.shippingAddress.city,
          zip: input.shippingAddress.zip,
          phone: input.shippingAddress.phone,
          countryCode: input.shippingAddress.countryCode ?? "IN",
        },
        financialStatus: "PAID",
        tags: ["quick-commerce", "dark-store"],
        note: input.note,
        transactions: [
          {
            kind: "SALE",
            status: "SUCCESS",
            amountSet: {
              shopMoney: {
                amount: input.totalAmount,
                currencyCode,
              },
            },
          },
        ],
      },
      options: {
        sendReceipt: false,
        sendFulfillmentReceipt: false,
        // Dark-store already reserved stock; absolute qty is re-pushed after create.
        inventoryBehaviour: "BYPASS",
      },
    },
  );

  userErrors(data.orderCreate.userErrors, "orderCreate");
  const order = data.orderCreate.order;
  if (!order?.id || !order.name) {
    throw new Error("Shopify orderCreate returned no order");
  }

  return { orderId: order.id, orderName: order.name };
}

export type ShopifyFulfillmentResult = {
  fulfillmentId: string;
  status: string;
};

/**
 * Mark a Shopify order as fulfilled (all open fulfillment orders), optionally
 * with tracking. Uses fulfillmentCreate against merchant-managed FOs.
 */
export async function fulfillShopifyOrder(
  creds: ShopifyCredentials,
  input: {
    shopifyOrderId: string;
    trackingCompany?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    notifyCustomer?: boolean;
  },
): Promise<ShopifyFulfillmentResult | null> {
  const orderData = await shopifyGraphql<{
    order: {
      id: string;
      displayFulfillmentStatus: string;
      fulfillmentOrders: {
        edges: Array<{
          node: {
            id: string;
            status: string;
          };
        }>;
      };
    } | null;
  }>(
    creds,
    `#graphql
      query OrderFulfillmentOrders($id: ID!) {
        order(id: $id) {
          id
          displayFulfillmentStatus
          fulfillmentOrders(first: 10) {
            edges {
              node {
                id
                status
              }
            }
          }
        }
      }`,
    { id: input.shopifyOrderId },
  );

  const order = orderData.order;
  if (!order) {
    throw new Error(`Shopify order not found: ${input.shopifyOrderId}`);
  }

  if (order.displayFulfillmentStatus === "FULFILLED") {
    return null;
  }

  const openFulfillmentOrders = order.fulfillmentOrders.edges
    .map((e) => e.node)
    .filter((fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS");

  if (openFulfillmentOrders.length === 0) {
    throw new Error(
      `No open fulfillment orders for ${input.shopifyOrderId} (status=${order.displayFulfillmentStatus})`,
    );
  }

  // Shopify rejects the whole fulfillment on a malformed URL, so repair it or leave it out.
  const trackingUrl = normalizeHttpUrl(input.trackingUrl);
  const trackingInfo =
    input.trackingNumber || trackingUrl || input.trackingCompany
      ? {
          ...(input.trackingCompany ? { company: input.trackingCompany } : {}),
          ...(input.trackingNumber ? { number: input.trackingNumber } : {}),
          ...(trackingUrl ? { url: trackingUrl } : {}),
        }
      : undefined;

  const data = await shopifyGraphql<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: ShopifyGraphqlError[];
    };
  }>(
    creds,
    `#graphql
      mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) {
          fulfillment {
            id
            status
          }
          userErrors { field message }
        }
      }`,
    {
      fulfillment: {
        notifyCustomer: input.notifyCustomer ?? false,
        ...(trackingInfo ? { trackingInfo } : {}),
        lineItemsByFulfillmentOrder: openFulfillmentOrders.map((fo) => ({
          fulfillmentOrderId: fo.id,
        })),
      },
    },
  );

  userErrors(data.fulfillmentCreate.userErrors, "fulfillmentCreate");
  const fulfillment = data.fulfillmentCreate.fulfillment;
  if (!fulfillment?.id) {
    throw new Error("Shopify fulfillmentCreate returned no fulfillment");
  }

  return { fulfillmentId: fulfillment.id, status: fulfillment.status };
}
