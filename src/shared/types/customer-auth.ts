export type CustomerAuthUser = {
  customerId: string;
  email: string;
  name: string;
};

/** JWT claim shape for customer sessions — no business_id/store_id, customers aren't tenant-scoped. */
export type CustomerJwtClaims = {
  sub: string;
  type: "customer";
  email: string;
  name: string;
};
