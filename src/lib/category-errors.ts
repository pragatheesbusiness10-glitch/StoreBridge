// Translate raw Supabase / Postgres errors on product_categories into
// short, human-readable messages for toasts and inline hints.
export function friendlyCategoryError(err: unknown): string {
  const anyErr = err as { code?: string; message?: string; details?: string } | null;
  const code = anyErr?.code;
  const msg = (anyErr?.message ?? "").toLowerCase();
  const details = (anyErr?.details ?? "").toLowerCase();

  // RLS / permission
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "You don't have permission to change this category. Only the creator or an admin can edit or delete it.";
  }
  // Unique violation (name or slug already exists)
  if (code === "23505" || msg.includes("duplicate key")) {
    if (details.includes("slug")) return "A category with that URL slug already exists. Try a different name.";
    if (details.includes("name")) return "A category with that name already exists.";
    return "That category already exists.";
  }
  // FK / dependency
  if (code === "23503" || msg.includes("foreign key")) {
    return "This category is still in use and can't be removed.";
  }
  // Not-null violation
  if (code === "23502" || msg.includes("null value")) {
    return "Please fill in all required fields.";
  }
  return anyErr?.message?.trim() || "Something went wrong. Please try again.";
}

export function validateCategoryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed.length < 2) return "Name must be at least 2 characters";
  if (trimmed.length > 80) return "Name must be under 80 characters";
  return null;
}