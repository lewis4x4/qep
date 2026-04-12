export const EQUIPMENT_SAFE_SELECT_COLS = [
  "id", "company_id", "primary_contact_id", "name", "asset_tag", "serial_number",
  "make", "model", "year", "category", "vin_pin",
  "condition", "availability", "ownership",
  "engine_hours", "mileage", "fuel_type", "weight_class", "operating_capacity",
  "location_description", "latitude", "longitude",
  "warranty_expires_on", "last_inspection_at", "next_service_due_at",
  "notes", "photo_urls",
  "metadata", "created_at", "updated_at",
].join(", ");

export const EQUIPMENT_FINANCIAL_SELECT_COLS = [
  "purchase_price", "current_market_value", "replacement_cost",
  "daily_rental_rate", "weekly_rental_rate", "monthly_rental_rate",
].join(", ");

export const EQUIPMENT_FULL_SELECT_COLS = [
  EQUIPMENT_SAFE_SELECT_COLS,
  EQUIPMENT_FINANCIAL_SELECT_COLS,
].join(", ");

export function mapEquipmentRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    companyId: row.company_id,
    primaryContactId: row.primary_contact_id,
    name: row.name,
    assetTag: row.asset_tag,
    serialNumber: row.serial_number,
    make: row.make ?? null,
    model: row.model ?? null,
    year: row.year ?? null,
    category: row.category ?? null,
    vinPin: row.vin_pin ?? null,
    condition: row.condition ?? null,
    availability: row.availability ?? "available",
    ownership: row.ownership ?? "customer_owned",
    engineHours: row.engine_hours != null ? Number(row.engine_hours) : null,
    mileage: row.mileage != null ? Number(row.mileage) : null,
    fuelType: row.fuel_type ?? null,
    weightClass: row.weight_class ?? null,
    operatingCapacity: row.operating_capacity ?? null,
    locationDescription: row.location_description ?? null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    purchasePrice: row.purchase_price != null ? Number(row.purchase_price) : null,
    currentMarketValue: row.current_market_value != null ? Number(row.current_market_value) : null,
    replacementCost: row.replacement_cost != null ? Number(row.replacement_cost) : null,
    dailyRentalRate: row.daily_rental_rate != null ? Number(row.daily_rental_rate) : null,
    weeklyRentalRate: row.weekly_rental_rate != null ? Number(row.weekly_rental_rate) : null,
    monthlyRentalRate: row.monthly_rental_rate != null ? Number(row.monthly_rental_rate) : null,
    warrantyExpiresOn: row.warranty_expires_on ?? null,
    lastInspectionAt: row.last_inspection_at ?? null,
    nextServiceDueAt: row.next_service_due_at ?? null,
    notes: row.notes ?? null,
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
