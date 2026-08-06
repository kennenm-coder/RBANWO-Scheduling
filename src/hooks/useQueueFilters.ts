"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  QueueFilterState,
  DEFAULT_FILTERS,
  loadPersistedFilters,
  persistFilters,
  isDefaultFilters,
} from "@/lib/queue-filters";

/**
 * Manages queue filter state with localStorage persistence.
 * Debounces persistence writes to avoid thrashing on rapid search typing.
 */
export function useQueueFilters() {
  const [filters, setFiltersRaw] = useState<QueueFilterState>(DEFAULT_FILTERS);
  const initialized = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setFiltersRaw(loadPersistedFilters());
    }
  }, []);

  // Debounced persistence
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!initialized.current) return;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistFilters(filters);
    }, 500);
    return () => clearTimeout(persistTimer.current);
  }, [filters]);

  const setFilters = useCallback(
    (updater: QueueFilterState | ((prev: QueueFilterState) => QueueFilterState)) => {
      setFiltersRaw(updater);
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFiltersRaw(DEFAULT_FILTERS);
  }, []);

  const isDefault = isDefaultFilters(filters);

  return { filters, setFilters, resetFilters, isDefault };
}
