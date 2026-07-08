import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";

export interface CategoryOption {
  id: string;
  name: string;
}

interface CategoryPickerProps {
  value: string;
  onChange: (name: string) => void;
  categories: CategoryOption[];
  isLoading?: boolean;
  disabled?: boolean;
  onCreateRequest?: (name: string) => void;
}

export function CategoryPicker({
  value,
  onChange,
  categories,
  isLoading,
  disabled,
  onCreateRequest,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebouncedValue(rawQuery, 200);
  const isTyping = rawQuery !== query;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  const trimmed = query.trim();
  const exactMatch = trimmed
    ? categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())
    : false;
  const canCreate = !!onCreateRequest && trimmed.length >= 2 && !exactMatch;

  function handleSelect(name: string) {
    onChange(name);
    setOpen(false);
    setRawQuery("");
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setRawQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          className="flex-1 justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || (isLoading ? "Loading categories…" : categories.length === 0 ? "No categories yet" : "Search categories…")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="relative">
            <CommandInput
              placeholder="Type to search or create…"
              value={rawQuery}
              onValueChange={setRawQuery}
            />
            {isTyping ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <CommandList>
            {value ? (
              <CommandGroup>
                <CommandItem value="__clear__" onSelect={() => handleSelect("")}>
                  Clear selection
                </CommandItem>
              </CommandGroup>
            ) : null}

            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : categories.length === 0 ? (
              <EmptyState
                icon={<Tag className="h-5 w-5" />}
                title="No categories yet"
                hint={onCreateRequest ? "Create your first category to get started." : "Ask an admin to add one."}
              />
            ) : filtered.length === 0 && !canCreate ? (
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title={trimmed ? `No matches for “${trimmed}”` : "No categories"}
                hint={trimmed ? "Try a different search term." : undefined}
              />
            ) : (
              filtered.length > 0 && (
                <CommandGroup heading={`Categories (${filtered.length})`}>
                  {filtered.map((c) => (
                    <CommandItem key={c.id} value={c.name} onSelect={() => handleSelect(c.name)}>
                      <Check className={cn("mr-2 h-4 w-4", value === c.name ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{c.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            )}

            {canCreate ? (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={() => {
                    onCreateRequest!(trimmed);
                    setOpen(false);
                    setRawQuery("");
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" /> Create “{trimmed}”
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="py-6 px-4 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}