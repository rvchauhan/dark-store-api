/**
 * OpenAPI 3.0 specification for Dark Store Partner API.
 * Served at GET /api-docs via swagger-ui-express.
 *
 * Portal-only and customer-app routes exist on the server but are omitted here.
 */
export const openApiSpec = {
  "openapi": "3.0.3",
  "info": {
    "title": "Dark Store Partner API",
    "version": "0.1.0",
    "description": "Open API for Shopify apps and organization integrations.\n\n**Authentication**\n\nClick **Authorize** and paste a **StaffBearer** JWT from `/api/partner/provision` or `/api/partner/session`.\n\nPlatform partner key (`x-api-key`) is only for `/api/partner/*` — enter it as a request header on those operations (not in Authorize).\n\nShopify: backend holds the platform key → provision (install) or session (app open) → JWT. Never put the platform key in the browser.",
    "contact": {
      "name": "Dark Store Team"
    }
  },
  "servers": [
    {
      "url": "http://localhost:3001",
      "description": "Local dev"
    }
  ],
  "components": {
    "securitySchemes": {
      "StaffBearer": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "Staff JWT from POST /api/partner/provision or /api/partner/session (or portal login)."
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string",
            "example": "Not found"
          },
          "code": {
            "type": "string",
            "example": "NOT_FOUND"
          }
        },
        "required": [
          "error"
        ]
      },
      "Pagination": {
        "type": "object",
        "properties": {
          "page": {
            "type": "integer",
            "example": 1
          },
          "pageSize": {
            "type": "integer",
            "example": 25
          },
          "total": {
            "type": "integer",
            "example": 142
          },
          "totalPages": {
            "type": "integer",
            "example": 6
          }
        }
      },
      "PartnerKey": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "businessId": {
            "type": "string",
            "format": "uuid",
            "nullable": true,
            "description": "null for platform keys"
          },
          "isPlatform": {
            "type": "boolean"
          },
          "name": {
            "type": "string",
            "example": "Shopify App"
          },
          "keyPrefix": {
            "type": "string",
            "example": "dsk_live_9f2a3b",
            "description": "Non-secret leading segment, for identifying a key in listings"
          },
          "scopes": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "read",
                "write"
              ]
            }
          },
          "lastUsedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "expiresAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "revokedAt": {
            "type": "string",
            "format": "date-time",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "PartnerKeyCreated": {
        "allOf": [
          {
            "$ref": "#/components/schemas/PartnerKey"
          },
          {
            "type": "object",
            "properties": {
              "businessName": {
                "type": "string"
              },
              "key": {
                "type": "string",
                "example": "dsk_live_9f2a3b8c...",
                "description": "The raw secret. Returned only here — only a SHA-256 hash is stored, so it cannot be retrieved again."
              },
              "warning": {
                "type": "string"
              }
            }
          }
        ]
      },
      "AuthUser": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "format": "uuid",
            "nullable": true,
            "description": "null when the request authenticated with a partner API key"
          },
          "businessId": {
            "type": "string",
            "format": "uuid"
          },
          "role": {
            "type": "string",
            "enum": [
              "business_admin",
              "store_manager",
              "store_employee"
            ]
          },
          "storeId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "name": {
            "type": "string"
          }
        }
      },
      "CustomerAuthUser": {
        "type": "object",
        "properties": {
          "customerId": {
            "type": "string",
            "format": "uuid"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "name": {
            "type": "string"
          }
        }
      },
      "AuthResponse": {
        "type": "object",
        "properties": {
          "token": {
            "type": "string",
            "example": "eyJhbGciOiJIUzI1NiIs..."
          },
          "user": {
            "$ref": "#/components/schemas/AuthUser"
          }
        }
      },
      "CustomerAuthResponse": {
        "type": "object",
        "properties": {
          "token": {
            "type": "string"
          },
          "customer": {
            "$ref": "#/components/schemas/CustomerAuthUser"
          }
        }
      },
      "Sku": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "businessId": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "brand": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "nullable": true
          },
          "barcode": {
            "type": "string",
            "nullable": true
          },
          "basePrice": {
            "type": "string",
            "example": "45.00"
          },
          "currency": {
            "type": "string",
            "example": "USD"
          },
          "compareAtPrice": {
            "type": "string",
            "nullable": true
          },
          "costPrice": {
            "type": "string",
            "nullable": true
          },
          "taxRate": {
            "type": "string",
            "example": "0.00"
          },
          "allowBackorder": {
            "type": "boolean"
          },
          "unitOfMeasure": {
            "type": "string"
          },
          "skuCode": {
            "type": "string",
            "nullable": true
          },
          "isFragile": {
            "type": "boolean"
          },
          "requiresColdStorage": {
            "type": "boolean"
          },
          "weightKg": {
            "type": "string",
            "nullable": true
          },
          "dimensionsCm": {
            "type": "object",
            "nullable": true
          },
          "defaultReorderPoint": {
            "type": "integer"
          },
          "defaultInitialStock": {
            "type": "integer",
            "nullable": true
          },
          "images": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uri"
            }
          },
          "description": {
            "type": "string",
            "nullable": true
          },
          "specs": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "variantOptions": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "variants": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "active",
              "archived"
            ]
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "CreateSkuBody": {
        "type": "object",
        "required": [
          "name",
          "basePrice",
          "unitOfMeasure"
        ],
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 200
          },
          "brand": {
            "type": "string",
            "maxLength": 60
          },
          "category": {
            "type": "string",
            "maxLength": 60
          },
          "barcode": {
            "type": "string",
            "description": "8–14 digit barcode"
          },
          "basePrice": {
            "type": "number",
            "minimum": 0,
            "example": 45
          },
          "currency": {
            "type": "string",
            "length": 3,
            "default": "USD"
          },
          "compareAtPrice": {
            "type": "number",
            "nullable": true
          },
          "costPrice": {
            "type": "number",
            "nullable": true
          },
          "taxRate": {
            "type": "number",
            "minimum": 0,
            "maximum": 100,
            "default": 0
          },
          "allowBackorder": {
            "type": "boolean",
            "default": false
          },
          "unitOfMeasure": {
            "type": "string",
            "default": "each"
          },
          "skuCode": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9-_]*$"
          },
          "isFragile": {
            "type": "boolean",
            "default": false
          },
          "requiresColdStorage": {
            "type": "boolean",
            "default": false
          },
          "weightKg": {
            "type": "number"
          },
          "dimensionsCm": {
            "type": "object",
            "properties": {
              "length": {
                "type": "number"
              },
              "width": {
                "type": "number"
              },
              "height": {
                "type": "number"
              }
            }
          },
          "defaultReorderPoint": {
            "type": "integer",
            "default": 10
          },
          "defaultInitialStock": {
            "type": "integer"
          },
          "variantOptions": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "variants": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "images": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uri"
            }
          },
          "description": {
            "type": "string",
            "maxLength": 5000
          },
          "specs": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "active"
            ],
            "default": "draft"
          }
        }
      },
      "Store": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "businessId": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "code": {
            "type": "string",
            "nullable": true
          },
          "address": {
            "type": "string"
          },
          "geofence": {
            "type": "object"
          },
          "operatingHours": {
            "type": "object"
          },
          "facility": {
            "type": "object",
            "nullable": true
          },
          "status": {
            "type": "string",
            "enum": [
              "onboarding",
              "active",
              "inactive",
              "closed"
            ]
          },
          "managerUserId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "managerName": {
            "type": "string",
            "nullable": true
          },
          "managerEmail": {
            "type": "string",
            "format": "email",
            "nullable": true
          },
          "managerStatus": {
            "type": "string",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "CreateStoreBody": {
        "type": "object",
        "required": [
          "name",
          "address",
          "geofence",
          "operatingHours"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "code": {
            "type": "string"
          },
          "address": {
            "type": "string"
          },
          "geofence": {
            "type": "object",
            "example": {
              "type": "circle",
              "radiusKm": 5,
              "center": {
                "lat": 51.543,
                "lng": -0.022
              }
            }
          },
          "operatingHours": {
            "type": "object",
            "example": {
              "timezone": "Europe/London",
              "open": "06:00",
              "close": "23:00"
            }
          },
          "facility": {
            "type": "object"
          }
        }
      },
      "SkuMapping": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "storeId": {
            "type": "string",
            "format": "uuid"
          },
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "priceOverride": {
            "type": "string",
            "nullable": true
          },
          "isListed": {
            "type": "boolean"
          },
          "reorderThreshold": {
            "type": "integer"
          },
          "skuName": {
            "type": "string"
          },
          "brand": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "nullable": true
          },
          "barcode": {
            "type": "string",
            "nullable": true
          },
          "basePrice": {
            "type": "string"
          },
          "catalogStatus": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "DashboardStats": {
        "type": "object",
        "properties": {
          "since": {
            "type": "string",
            "format": "date-time"
          },
          "activeStores": {
            "type": "integer"
          },
          "totalStores": {
            "type": "integer"
          },
          "skusInCatalog": {
            "type": "integer"
          },
          "totalPickedUnits24h": {
            "type": "integer"
          },
          "lowStockAlerts": {
            "type": "integer"
          },
          "perStorePicked": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "storeId": {
                  "type": "string",
                  "format": "uuid"
                },
                "storeName": {
                  "type": "string"
                },
                "storeCode": {
                  "type": "string",
                  "nullable": true
                },
                "pickedUnits": {
                  "type": "integer"
                }
              }
            }
          }
        }
      },
      "InventoryRow": {
        "type": "object",
        "properties": {
          "storeId": {
            "type": "string",
            "format": "uuid"
          },
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "availableQty": {
            "type": "integer"
          },
          "lastLedgerId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "isListed": {
            "type": "boolean"
          },
          "priceOverride": {
            "type": "string",
            "nullable": true
          },
          "reorderThreshold": {
            "type": "integer"
          },
          "skuName": {
            "type": "string"
          },
          "brand": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "nullable": true
          },
          "barcode": {
            "type": "string",
            "nullable": true
          },
          "basePrice": {
            "type": "string"
          }
        }
      },
      "LedgerEntry": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "storeId": {
            "type": "string",
            "format": "uuid"
          },
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "type": {
            "type": "string",
            "enum": [
              "stock_in",
              "sale",
              "damage",
              "return",
              "adjustment",
              "correction"
            ]
          },
          "quantity": {
            "type": "integer"
          },
          "referenceId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "source": {
            "type": "string",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "employeeId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "employeeName": {
            "type": "string",
            "nullable": true
          },
          "skuName": {
            "type": "string"
          },
          "barcode": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "nullable": true
          },
          "balance": {
            "type": "integer"
          }
        }
      },
      "LedgerSummary": {
        "type": "object",
        "properties": {
          "since": {
            "type": "string",
            "format": "date-time"
          },
          "restockUnits": {
            "type": "integer"
          },
          "pickedUnits": {
            "type": "integer"
          },
          "damageUnits": {
            "type": "integer"
          },
          "returnUnits": {
            "type": "integer"
          },
          "adjustmentUnits": {
            "type": "integer"
          }
        }
      },
      "StockInBody": {
        "type": "object",
        "required": [
          "skuId",
          "quantity"
        ],
        "properties": {
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "quantity": {
            "type": "integer",
            "minimum": 1
          },
          "source": {
            "type": "string"
          },
          "referenceId": {
            "type": "string",
            "format": "uuid"
          }
        }
      },
      "MovementBody": {
        "type": "object",
        "required": [
          "skuId",
          "type"
        ],
        "properties": {
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "type": {
            "type": "string",
            "enum": [
              "stock_in",
              "sale",
              "damage",
              "return",
              "adjustment",
              "correction"
            ]
          },
          "quantity": {
            "type": "integer",
            "description": "Always positive; service applies sign"
          },
          "signedQuantity": {
            "type": "integer",
            "description": "Use for adjustment/correction when delta can be negative"
          },
          "source": {
            "type": "string"
          },
          "referenceId": {
            "type": "string",
            "format": "uuid"
          }
        }
      },
      "StorefrontProduct": {
        "type": "object",
        "properties": {
          "skuId": {
            "type": "string",
            "format": "uuid"
          },
          "name": {
            "type": "string"
          },
          "brand": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "nullable": true
          },
          "price": {
            "type": "string",
            "example": "45.00"
          },
          "compareAtPrice": {
            "type": "string",
            "nullable": true
          },
          "unitOfMeasure": {
            "type": "string"
          },
          "images": {
            "type": "array",
            "items": {
              "type": "string",
              "format": "uri"
            }
          },
          "description": {
            "type": "string",
            "nullable": true
          },
          "availableQty": {
            "type": "integer"
          }
        }
      },
      "Cart": {
        "type": "object",
        "properties": {
          "cartId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "storeId": {
            "type": "string",
            "format": "uuid",
            "nullable": true
          },
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "skuId": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                },
                "image": {
                  "nullable": true
                },
                "price": {
                  "type": "string"
                },
                "quantity": {
                  "type": "integer"
                },
                "lineTotal": {
                  "type": "string"
                }
              }
            }
          },
          "itemsTotal": {
            "type": "string",
            "example": "90.00"
          }
        }
      },
      "Order": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "customerId": {
            "type": "string",
            "format": "uuid"
          },
          "businessId": {
            "type": "string",
            "format": "uuid"
          },
          "storeId": {
            "type": "string",
            "format": "uuid"
          },
          "status": {
            "type": "string",
            "enum": [
              "placed",
              "confirmed",
              "preparing",
              "out_for_delivery",
              "fulfilled",
              "cancelled"
            ]
          },
          "deliveryAddress": {
            "type": "object"
          },
          "paymentMethod": {
            "type": "string",
            "enum": [
              "upi",
              "card"
            ]
          },
          "itemsTotal": {
            "type": "string"
          },
          "deliveryFee": {
            "type": "string"
          },
          "handlingFee": {
            "type": "string"
          },
          "totalAmount": {
            "type": "string"
          },
          "riderName": {
            "type": "string",
            "nullable": true
          },
          "riderPhone": {
            "type": "string",
            "nullable": true
          },
          "trackingName": {
            "type": "string",
            "nullable": true
          },
          "trackingNumber": {
            "type": "string",
            "nullable": true
          },
          "trackingUrl": {
            "type": "string",
            "nullable": true
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "CheckoutBody": {
        "type": "object",
        "required": [
          "deliveryAddress",
          "paymentMethod"
        ],
        "properties": {
          "deliveryAddress": {
            "type": "object",
            "required": [
              "line1",
              "city",
              "postalCode",
              "phone"
            ],
            "properties": {
              "line1": {
                "type": "string"
              },
              "line2": {
                "type": "string"
              },
              "city": {
                "type": "string"
              },
              "postalCode": {
                "type": "string"
              },
              "phone": {
                "type": "string"
              }
            }
          },
          "paymentMethod": {
            "type": "string",
            "enum": [
              "upi",
              "card"
            ]
          }
        }
      },
      "AnalyticsOverview": {
        "type": "object",
        "properties": {
          "windowDays": {
            "type": "integer",
            "example": 30
          },
          "revenueTrend": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "day": {
                  "type": "string",
                  "format": "date"
                },
                "revenue": {
                  "type": "number"
                },
                "orderCount": {
                  "type": "integer"
                }
              }
            }
          },
          "unitsTrend": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "day": {
                  "type": "string",
                  "format": "date"
                },
                "units": {
                  "type": "integer"
                }
              }
            }
          },
          "topSkus": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "skuId": {
                  "type": "string",
                  "format": "uuid"
                },
                "name": {
                  "type": "string"
                },
                "unitsSold": {
                  "type": "integer"
                },
                "revenue": {
                  "type": "number"
                }
              }
            }
          },
          "slowMovers": {
            "type": "array",
            "items": {
              "type": "object"
            }
          },
          "statusBreakdown": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "status": {
                  "type": "string"
                },
                "count": {
                  "type": "integer"
                }
              }
            }
          },
          "avgFulfillmentMinutes": {
            "type": "integer",
            "nullable": true
          }
        }
      }
    },
    "responses": {
      "Unauthorized": {
        "description": "Missing or invalid Bearer token",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "Forbidden": {
        "description": "Authenticated but insufficient role",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "NotFound": {
        "description": "Resource not found",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "Conflict": {
        "description": "Conflict (duplicate / business rule violation)",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "ValidationError": {
        "description": "Invalid request body or query params",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "ApiKeyNotAllowed": {
        "description": "Partner API key rejected — this endpoint requires a signed-in person (`API_KEY_NOT_ALLOWED`), or the key lacks the `write` scope (`INSUFFICIENT_SCOPE`)",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      }
    },
    "parameters": {
      "StoreId": {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "Store UUID"
      },
      "StoreIdParam": {
        "name": "storeId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "Store UUID (nested routes)"
      },
      "SkuId": {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "SKU UUID"
      },
      "SkuIdPath": {
        "name": "skuId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "SKU UUID"
      },
      "OrderId": {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "Order UUID"
      },
      "OrderIdParam": {
        "name": "orderId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid"
        },
        "description": "Order UUID (nested routes)"
      }
    }
  },
  "tags": [
    {
      "name": "Health",
      "description": "Service liveness"
    },
    {
      "name": "Partner Provision",
      "description": "Platform-key endpoints for Shopify (or similar) install: create Business + store admin and return a JWT for immediate portal login."
    },
    {
      "name": "Catalog",
      "description": "Master product catalog (admin)"
    },
    {
      "name": "Stores",
      "description": "Store management and SKU assignments"
    },
    {
      "name": "Inventory",
      "description": "Stock-in, movements, ledger, snapshots"
    },
    {
      "name": "Store Orders",
      "description": "Staff order fulfillment and status updates"
    },
    {
      "name": "Analytics",
      "description": "Business-wide revenue and SKU analytics (admin)"
    },
    {
      "name": "Geo",
      "description": "Forward geocoding for store wizard"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "Health"
        ],
        "summary": "Health check",
        "operationId": "healthCheck",
        "responses": {
          "200": {
            "description": "Service is up",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "example": "ok"
                    },
                    "service": {
                      "type": "string",
                      "example": "dark-store-api"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/partner/provision": {
      "post": {
        "tags": [
          "Partner Provision"
        ],
        "summary": "Provision a merchant + store admin (Shopify install)",
        "operationId": "partnerProvision",
        "description": "Idempotent on (provider, externalId). Creates a Business and business_admin, or reuses them on reinstall, and returns a staff JWT for immediate login.\n\nOptional `store` creates the first dark store in the same transaction.\n\nCall this from the **Shopify app backend** only — never from the browser. Requires a **platform** partner key (`npm run partner-key:create -- --platform`).",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "externalId",
                  "organizationName",
                  "admin"
                ],
                "properties": {
                  "provider": {
                    "type": "string",
                    "default": "shopify",
                    "example": "shopify"
                  },
                  "externalId": {
                    "type": "string",
                    "example": "acme.myshopify.com",
                    "description": "Unique external identity (Shopify shop domain, site id, …)"
                  },
                  "organizationName": {
                    "type": "string",
                    "example": "Acme Retail"
                  },
                  "displayName": {
                    "type": "string"
                  },
                  "metadata": {
                    "type": "object",
                    "additionalProperties": true
                  },
                  "admin": {
                    "type": "object",
                    "required": [
                      "email",
                      "name"
                    ],
                    "properties": {
                      "email": {
                        "type": "string",
                        "format": "email"
                      },
                      "name": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "password": {
                        "type": "string",
                        "minLength": 8,
                        "description": "Optional — enables later portal email/password login"
                      }
                    }
                  },
                  "store": {
                    "type": "object",
                    "required": [
                      "name",
                      "address"
                    ],
                    "description": "Optional first dark store created at install time",
                    "properties": {
                      "name": {
                        "type": "string",
                        "example": "Acme Main Dark Store"
                      },
                      "address": {
                        "type": "string"
                      },
                      "code": {
                        "type": "string"
                      },
                      "geofence": {
                        "type": "object"
                      },
                      "operatingHours": {
                        "type": "object"
                      },
                      "activate": {
                        "type": "boolean",
                        "default": true
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Existing installation — fresh JWT returned",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "201": {
            "description": "New merchant created — JWT included for immediate login",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "created": {
                      "type": "boolean",
                      "example": true
                    },
                    "business": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "name": {
                          "type": "string"
                        }
                      }
                    },
                    "installation": {
                      "type": "object"
                    },
                    "store": {
                      "type": "object",
                      "nullable": true,
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "name": {
                          "type": "string"
                        },
                        "status": {
                          "type": "string"
                        },
                        "address": {
                          "type": "string"
                        }
                      }
                    },
                    "token": {
                      "type": "string",
                      "description": "Staff JWT — use as Authorization: Bearer"
                    },
                    "user": {
                      "$ref": "#/components/schemas/AuthUser"
                    },
                    "passwordSet": {
                      "type": "boolean"
                    },
                    "hint": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        },
        "parameters": [
          {
            "name": "x-api-key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "example": "dsk_live_…"
            },
            "description": "Platform partner key (`dsk_…`). Required on this endpoint. Not available via Authorize — paste here for Try it out."
          }
        ]
      }
    },
    "/api/partner/session": {
      "post": {
        "tags": [
          "Partner Provision"
        ],
        "summary": "App-open login — issue JWT for an existing Shopify shop",
        "operationId": "partnerSession",
        "description": "Lightweight login for every app open. Looks up `(provider, externalId)` and returns a fresh staff JWT + store list.\n\nReturns `404 INSTALLATION_NOT_FOUND` if provision was never called — the Shopify backend should then call `/provision`.\n\nCall from the **Shopify app backend** only (partner key stays server-side).",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "externalId"
                ],
                "properties": {
                  "provider": {
                    "type": "string",
                    "default": "shopify"
                  },
                  "externalId": {
                    "type": "string",
                    "example": "acme.myshopify.com"
                  },
                  "adminEmail": {
                    "type": "string",
                    "format": "email",
                    "description": "Optional — prefer this admin within the business"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Session issued",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "created": {
                      "type": "boolean",
                      "example": false
                    },
                    "business": {
                      "type": "object"
                    },
                    "installation": {
                      "type": "object"
                    },
                    "stores": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    },
                    "token": {
                      "type": "string"
                    },
                    "user": {
                      "$ref": "#/components/schemas/AuthUser"
                    },
                    "passwordSet": {
                      "type": "boolean"
                    },
                    "hint": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        },
        "parameters": [
          {
            "name": "x-api-key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "example": "dsk_live_…"
            },
            "description": "Platform partner key (`dsk_…`). Required on this endpoint. Not available via Authorize — paste here for Try it out."
          }
        ]
      }
    },
    "/api/partner/uninstall": {
      "post": {
        "tags": [
          "Partner Provision"
        ],
        "summary": "Soft-uninstall an external installation",
        "operationId": "partnerUninstall",
        "description": "Marks the installation uninstalled. Does not delete the Business or admin.",
        "security": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "externalId"
                ],
                "properties": {
                  "provider": {
                    "type": "string",
                    "default": "shopify"
                  },
                  "externalId": {
                    "type": "string",
                    "example": "acme.myshopify.com"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Uninstalled",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        },
        "parameters": [
          {
            "name": "x-api-key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "example": "dsk_live_…"
            },
            "description": "Platform partner key (`dsk_…`). Required on this endpoint. Not available via Authorize — paste here for Try it out."
          }
        ]
      }
    },
    "/api/catalog/skus": {
      "post": {
        "tags": [
          "Catalog"
        ],
        "summary": "Create a new SKU (admin only)",
        "operationId": "createSku",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateSkuBody"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created SKU",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sku"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        }
      },
      "get": {
        "tags": [
          "Catalog"
        ],
        "summary": "List SKUs (supports filtering and search)",
        "operationId": "listSkus",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "draft",
                "active",
                "archived",
                "unassigned"
              ]
            },
            "description": "`unassigned` = SKUs not assigned to any store"
          },
          {
            "name": "search",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Searches name, brand, barcode, skuCode"
          }
        ],
        "responses": {
          "200": {
            "description": "List of SKUs",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Sku"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/catalog/meta": {
      "get": {
        "tags": [
          "Catalog"
        ],
        "summary": "Distinct brands and categories for dropdown filters",
        "operationId": "getCatalogMeta",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Brand and category lists",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "brands": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "categories": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/catalog/uploads": {
      "post": {
        "tags": [
          "Catalog"
        ],
        "summary": "Upload a product image (base64) — returns hosted URL",
        "operationId": "uploadImage",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "fileName",
                  "mimeType",
                  "data"
                ],
                "properties": {
                  "fileName": {
                    "type": "string"
                  },
                  "mimeType": {
                    "type": "string",
                    "enum": [
                      "image/png",
                      "image/jpeg",
                      "image/webp"
                    ]
                  },
                  "data": {
                    "type": "string",
                    "description": "Base64-encoded image (no data: prefix)"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Hosted URL",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "url": {
                      "type": "string",
                      "format": "uri"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/catalog/skus/{id}": {
      "get": {
        "tags": [
          "Catalog"
        ],
        "summary": "Get a single SKU",
        "operationId": "getSku",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/SkuId"
          }
        ],
        "responses": {
          "200": {
            "description": "SKU",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sku"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      },
      "patch": {
        "tags": [
          "Catalog"
        ],
        "summary": "Update SKU fields (admin only, partial update)",
        "operationId": "updateSku",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/SkuId"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "allOf": [
                  {
                    "$ref": "#/components/schemas/CreateSkuBody"
                  }
                ],
                "description": "All fields optional — only provided fields are changed"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated SKU",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Sku"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        }
      }
    },
    "/api/stores": {
      "post": {
        "tags": [
          "Stores"
        ],
        "summary": "Create a store (admin only)",
        "operationId": "createStore",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateStoreBody"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created store",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Store"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "get": {
        "tags": [
          "Stores"
        ],
        "summary": "List stores (admin sees all; manager sees own store)",
        "operationId": "listStores",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Stores list",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Store"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/dashboard-stats": {
      "get": {
        "tags": [
          "Stores"
        ],
        "summary": "Business-wide dashboard stats (admin only)",
        "operationId": "getDashboardStats",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Dashboard aggregates",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/DashboardStats"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/api/stores/{id}": {
      "get": {
        "tags": [
          "Stores"
        ],
        "summary": "Get a single store",
        "operationId": "getStore",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "responses": {
          "200": {
            "description": "Store",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Store"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      },
      "patch": {
        "tags": [
          "Stores"
        ],
        "summary": "Update store (admin: all fields; manager: operatingHours/facility only)",
        "operationId": "updateStore",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CreateStoreBody"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated store",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Store"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    },
    "/api/stores/{id}/activate": {
      "post": {
        "tags": [
          "Stores"
        ],
        "summary": "Activate a store (admin only)",
        "operationId": "activateStore",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "responses": {
          "200": {
            "description": "Activated store",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Store"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    },
    "/api/stores/{id}/sku-mappings": {
      "post": {
        "tags": [
          "Stores"
        ],
        "summary": "Assign a SKU to a store (admin only)",
        "operationId": "assignSku",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "description": "Provide skuId OR barcode",
                "properties": {
                  "skuId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "barcode": {
                    "type": "string"
                  },
                  "priceOverride": {
                    "type": "number",
                    "nullable": true
                  },
                  "isListed": {
                    "type": "boolean",
                    "default": false
                  },
                  "reorderThreshold": {
                    "type": "integer",
                    "default": 10
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created mapping",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SkuMapping"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        }
      },
      "get": {
        "tags": [
          "Stores"
        ],
        "summary": "List SKU mappings for a store",
        "operationId": "listSkuMappings",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "responses": {
          "200": {
            "description": "Mappings",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/SkuMapping"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{id}/sku-mappings/bulk": {
      "post": {
        "tags": [
          "Stores"
        ],
        "summary": "Bulk assign SKUs via JSON array or CSV (admin only)",
        "operationId": "bulkAssignSkus",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "description": "Provide either `mappings` array or `csv` string",
                "properties": {
                  "mappings": {
                    "type": "array",
                    "items": {
                      "type": "object"
                    }
                  },
                  "csv": {
                    "type": "string",
                    "description": "CSV with header: sku_id,barcode,price_override,is_listed,reorder_threshold"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Bulk result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "assigned": {
                      "type": "integer"
                    },
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/SkuMapping"
                      }
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/api/stores/{id}/sku-mappings/{skuId}": {
      "patch": {
        "tags": [
          "Stores"
        ],
        "summary": "Update listing / price / threshold for a mapping (admin or manager)",
        "operationId": "updateSkuMapping",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          },
          {
            "$ref": "#/components/parameters/SkuIdPath"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "priceOverride": {
                    "type": "number",
                    "nullable": true
                  },
                  "isListed": {
                    "type": "boolean"
                  },
                  "reorderThreshold": {
                    "type": "integer"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated mapping",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/SkuMapping"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      },
      "delete": {
        "tags": [
          "Stores"
        ],
        "summary": "Remove SKU from store (blocked if ledger history exists)",
        "operationId": "removeSkuMapping",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreId"
          },
          {
            "$ref": "#/components/parameters/SkuIdPath"
          }
        ],
        "responses": {
          "200": {
            "description": "Removed",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "storeId": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "skuId": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "removed": {
                      "type": "boolean"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory": {
      "get": {
        "tags": [
          "Inventory"
        ],
        "summary": "Live inventory table for a store",
        "operationId": "listInventory",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          }
        ],
        "responses": {
          "200": {
            "description": "Inventory rows (snapshot + mapping + catalog)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/InventoryRow"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory/stock-in": {
      "post": {
        "tags": [
          "Inventory"
        ],
        "summary": "Record opening stock or restock (creates ledger + updates snapshot)",
        "operationId": "stockIn",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/StockInBody"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created ledger entry",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LedgerEntry"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory/movements": {
      "post": {
        "tags": [
          "Inventory"
        ],
        "summary": "Record any stock movement (damage / return / adjustment / correction)",
        "operationId": "recordMovement",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/MovementBody"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created ledger entry",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LedgerEntry"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory/ledger": {
      "get": {
        "tags": [
          "Inventory"
        ],
        "summary": "Paginated ledger history with running balance",
        "operationId": "getLedger",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date-time"
            }
          },
          {
            "name": "skuId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "type",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "stock_in",
                "sale",
                "damage",
                "return",
                "adjustment",
                "correction"
              ]
            }
          },
          {
            "name": "page",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 1
            }
          },
          {
            "name": "pageSize",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 25,
              "maximum": 100
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Paginated ledger entries",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/LedgerEntry"
                      }
                    },
                    "pagination": {
                      "$ref": "#/components/schemas/Pagination"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory/ledger/summary": {
      "get": {
        "tags": [
          "Inventory"
        ],
        "summary": "24-hour ledger summary cards (restock / picked / damage / return / adjustment)",
        "operationId": "getLedgerSummary",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          }
        ],
        "responses": {
          "200": {
            "description": "24h summary",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LedgerSummary"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/inventory/{skuId}": {
      "get": {
        "tags": [
          "Inventory"
        ],
        "summary": "Per-SKU snapshot + recent ledger history",
        "operationId": "getSkuInventory",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          },
          {
            "$ref": "#/components/parameters/SkuIdPath"
          },
          {
            "name": "historyLimit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50,
              "maximum": 200
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Snapshot + history",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "snapshot": {
                      "$ref": "#/components/schemas/InventoryRow"
                    },
                    "history": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/LedgerEntry"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    },
    "/api/stores/{storeId}/orders": {
      "get": {
        "tags": [
          "Store Orders"
        ],
        "summary": "List orders for a store (staff)",
        "operationId": "listStoreOrders",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "active",
                "all"
              ],
              "default": "active"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Orders with customer name and item count",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "allOf": [
                          {
                            "$ref": "#/components/schemas/Order"
                          },
                          {
                            "type": "object",
                            "properties": {
                              "customerName": {
                                "type": "string"
                              },
                              "itemCount": {
                                "type": "integer"
                              }
                            }
                          }
                        ]
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/orders/stats": {
      "get": {
        "tags": [
          "Store Orders"
        ],
        "summary": "Today's order stats (count, active, revenue)",
        "operationId": "getStoreOrderStats",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          }
        ],
        "responses": {
          "200": {
            "description": "Stats",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "todayCount": {
                      "type": "integer"
                    },
                    "activeCount": {
                      "type": "integer"
                    },
                    "todayRevenue": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/api/stores/{storeId}/orders/{orderId}": {
      "get": {
        "tags": [
          "Store Orders"
        ],
        "summary": "Get a store order with full line-item details",
        "operationId": "getStoreOrder",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          },
          {
            "$ref": "#/components/parameters/OrderIdParam"
          }
        ],
        "responses": {
          "200": {
            "description": "Order + enriched items",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "order": {
                      "$ref": "#/components/schemas/Order"
                    },
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    },
    "/api/stores/{storeId}/orders/{orderId}/status": {
      "patch": {
        "tags": [
          "Store Orders"
        ],
        "summary": "Advance order status (forward-only state machine)",
        "operationId": "updateOrderStatus",
        "description": "Allowed transitions: placed→confirmed→preparing→out_for_delivery→fulfilled. Any status can move to cancelled except fulfilled. `out_for_delivery` requires trackingName, trackingNumber, and trackingUrl.",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "$ref": "#/components/parameters/StoreIdParam"
          },
          {
            "$ref": "#/components/parameters/OrderIdParam"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "status"
                ],
                "properties": {
                  "status": {
                    "type": "string",
                    "enum": [
                      "confirmed",
                      "preparing",
                      "out_for_delivery",
                      "fulfilled",
                      "cancelled"
                    ]
                  },
                  "riderName": {
                    "type": "string"
                  },
                  "riderPhone": {
                    "type": "string"
                  },
                  "trackingName": {
                    "type": "string"
                  },
                  "trackingNumber": {
                    "type": "string"
                  },
                  "trackingUrl": {
                    "type": "string",
                    "format": "uri"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated order",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Order"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    },
    "/api/analytics/overview": {
      "get": {
        "tags": [
          "Analytics"
        ],
        "summary": "Business-wide analytics overview (admin only)",
        "operationId": "getAnalyticsOverview",
        "description": "Returns 14-day revenue/units trend, top/slow SKUs (30-day window), order status breakdown, and average fulfillment time.",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Analytics data",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AnalyticsOverview"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/api/geo/lookup": {
      "get": {
        "tags": [
          "Geo"
        ],
        "summary": "Forward geocode an address (Nominatim)",
        "operationId": "geoLookup",
        "security": [
          {
            "StaffBearer": []
          }
        ],
        "parameters": [
          {
            "name": "street",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "city",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "postalCode",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "country",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Geocoding result",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/ValidationError"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    }
  }
} as const;
