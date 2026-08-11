# Dark Store API

Separate backend service for the dark-store-portal frontend. Implements the HLD in `../dark-store-portal/darkstore.md` as a **modular monolith** — one deployable, three domain modules, Postgres only (no Redis).

## Architecture

```
dark-store-portal/     React frontend (TanStack Start) — port 8080
dark-store-api/        Express API (this repo)         — port 3001
        │
        └── PostgreSQL (Docker)
```

### Module boundaries (microservice-ready)

| Module    | Path prefix              | Schema tables                          | HLD step |
|-----------|--------------------------|----------------------------------------|----------|
| `auth`    | `/api/auth`              | `users` (read)                         | Phase 0  |
| `catalog` | `/api/catalog`           | `master_catalog`                       | Step 1   |
| `store`   | `/api/stores`            | `stores`, `store_sku_mapping` (TODO)   | Step 2–3 |
| `inventory` | `/api/stores/:id/inventory` | `inventory_ledger`, `inventory_snapshot` | Step 4–6 |

Each module folder is self-contained (`routes` → `service` → `schemas`). To extract a microservice later, move the folder + its schema tables into a new repo and replace in-process calls with HTTP.

## Quick start

```bash
# 1. Start Postgres (port 5433 — avoids local Postgres on 5432)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Run migrations + seed
npm run db:setup

# If migrations fail with "type already exists", reset the Docker volume:
# npm run db:reset

# 4. Start API dev server
npm run dev
```

## Demo credentials (from seed)

| Email               | Password | Role           |
|---------------------|----------|----------------|
| admin@qcommerce.io  | abcd123  | business_admin |
| manager@qcommerce.io| abcd123  | store_manager  |

## API examples

```bash
# Login
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@qcommerce.io","password":"password123"}'

# Create SKU (use token from login)
curl -s -X POST http://localhost:3001/api/catalog/skus \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Organic Almond Milk 1L","basePrice":2.40,"unitOfMeasure":"each"}'
```

## Implementation status

- [x] Phase 0: Postgres schema, JWT auth, RBAC middleware
- [x] Step 1: `POST/GET /api/catalog/skus`
- [x] Step 2: `POST/GET /api/stores`, `POST /api/stores/:id/activate`
- [x] Step 3: `POST/GET/PATCH/DELETE /api/stores/:id/sku-mappings` + bulk CSV
- [x] Step 4: `POST /api/stores/:id/inventory/stock-in` (transactional ledger + snapshot)
- [x] Step 5: Ledger history, SKU inventory, movements, 24h summary
- [ ] Step 6: Low-stock alerts — **skipped for now** (placeholder `GET .../alerts` remains 501)

## Step 5 examples

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager@qcommerce.io","password":"abcd123"}' | jq -r .token)

STORE_ID=<store-uuid>
SKU_ID=<sku-uuid>

# Live inventory table
curl -s "http://localhost:3001/api/stores/$STORE_ID/inventory" \
  -H "Authorization: Bearer $TOKEN"

# Paginated ledger (date / sku / type filters)
curl -s "http://localhost:3001/api/stores/$STORE_ID/inventory/ledger?page=1&pageSize=25&type=stock_in" \
  -H "Authorization: Bearer $TOKEN"

# 24h summary cards
curl -s "http://localhost:3001/api/stores/$STORE_ID/inventory/ledger/summary" \
  -H "Authorization: Bearer $TOKEN"

# One SKU: snapshot + history
curl -s "http://localhost:3001/api/stores/$STORE_ID/inventory/$SKU_ID" \
  -H "Authorization: Bearer $TOKEN"

# Record damage (quantity is positive; service stores -N)
curl -s -X POST "http://localhost:3001/api/stores/$STORE_ID/inventory/movements" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"skuId\":\"$SKU_ID\",\"type\":\"damage\",\"quantity\":2,\"source\":\"damaged unloading\"}"
```


## Step 3 examples

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@qcommerce.io","password":"abcd123"}' | jq -r .token)

STORE_ID=<store-uuid>
SKU_ID=<sku-uuid>

# Assign one SKU (wizard "Enable for Store")
curl -s -X POST "http://localhost:3001/api/stores/$STORE_ID/sku-mappings" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"skuId\":\"$SKU_ID\",\"isListed\":true,\"priceOverride\":2.5,\"reorderThreshold\":10}"

# Bulk CSV import (Import Batch card)
curl -s -X POST "http://localhost:3001/api/stores/$STORE_ID/sku-mappings/bulk" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"csv":"sku_id,barcode,price_override,is_listed,reorder_threshold\n'"$SKU_ID"',,2.50,true,10\n"}'

# List mappings
curl -s "http://localhost:3001/api/stores/$STORE_ID/sku-mappings" \
  -H "Authorization: Bearer $TOKEN"
```


## Frontend wiring

The portal (`../dark-store-portal`) now calls this API via TanStack Query + JWT.

1. Start API: `npm run dev` (port 3001)
2. In portal: `VITE_API_URL=http://localhost:3001` (see `.env.local`)
3. Sign in with seed users — or create an account at `/register`

### Auth endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Email + password → JWT |
| `POST` | `/api/auth/register` | Self-serve signup (new business + admin) → JWT |
| `POST` | `/api/auth/google` | Google Identity ID token → JWT (login or signup) |
| `GET` | `/api/auth/me` | Current user from Bearer token |

Google sign-in: set `GOOGLE_CLIENT_ID` here and `VITE_GOOGLE_CLIENT_ID` in the portal (same Web client ID). Add `http://localhost:8080` as an authorized JavaScript origin in Google Cloud Console.

