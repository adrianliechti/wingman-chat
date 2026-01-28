import { useState, useEffect, useRef, useCallback } from 'react';
import * as opfs from '../lib/opfs';

/**
 * Options for usePersistedState hook
 */
export interface UsePersistedStateOptions<T> {
  /** File path in OPFS (e.g., 'profile.json', 'bridge.json') */
  key: string;
  
  /** Default value when no persisted data exists */
  defaultValue: T;
  
  /** Debounce delay in ms before saving (default: 0 = immediate) */
  debounceMs?: number;
  
  /** Optional migration function from localStorage or other sources */
  migrate?: () => T | undefined;
  
  /** Optional validation/transformation on load */
  onLoad?: (data: T) => T;
  
  /** Optional transformation before save (return undefined to delete) */
  onSave?: (data: T) => T | undefined;
}

export interface UsePersistedStateReturn<T> {
  /** Current state value */
  value: T;
  
  /** Update the state */
  setValue: React.Dispatch<React.SetStateAction<T>>;
  
  /** Whether initial load from OPFS has completed */
  isLoaded: boolean;
  
  /** Force an immediate save (bypasses debounce) */
  flush: () => Promise<void>;
}

/**
 * Hook for persisting simple key-value state to OPFS.
 * Handles loading, saving, debouncing, and migration automatically.
 */
export function usePersistedState<T>(
  options: UsePersistedStateOptions<T>
): UsePersistedStateReturn<T> {
  const { key, defaultValue, debounceMs = 0, migrate, onLoad, onSave } = options;
  
  const [value, setValueInternal] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Refs to avoid stale closures in async callbacks
  const valueRef = useRef<T>(value);
  valueRef.current = value;
  
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);
  const isLoadedRef = useRef(false);
  
  // Save function using refs
  const save = useCallback(async () => {
    if (!isLoadedRef.current) return;
    
    try {
      const dataToSave = onSave ? onSave(valueRef.current) : valueRef.current;
      
      if (dataToSave === undefined) {
        await opfs.deleteFile(key);
      } else {
        await opfs.writeJson(key, dataToSave);
      }
      pendingSaveRef.current = false;
    } catch (error) {
      console.warn(`Failed to save ${key}:`, error);
    }
  }, [key, onSave]);
  
  // Load from OPFS on mount
  useEffect(() => {
    let cancelled = false;
    
    const load = async () => {
      try {
        let data = await opfs.readJson<T>(key);
        
        // Try migration if no data found
        if (data === undefined && migrate) {
          data = migrate();
          if (data !== undefined) {
            const toSave = onSave ? onSave(data) : data;
            if (toSave !== undefined) {
              await opfs.writeJson(key, toSave);
            }
          }
        }
        
        if (!cancelled && data !== undefined) {
          const processed = onLoad ? onLoad(data) : data;
          setValueInternal(processed);
        }
      } catch (error) {
        console.warn(`Failed to load ${key}:`, error);
      } finally {
        if (!cancelled) {
          isLoadedRef.current = true;
          setIsLoaded(true);
        }
      }
    };
    
    load();
    
    return () => {
      cancelled = true;
    };
  }, [key, migrate, onLoad, onSave]);
  
  // Debounced save effect
  useEffect(() => {
    if (!isLoaded) return;
    
    pendingSaveRef.current = true;
    
    if (debounceMs > 0) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(save, debounceMs);
    } else {
      save();
    }
  }, [value, isLoaded, debounceMs, save]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (pendingSaveRef.current && isLoadedRef.current) {
        const dataToSave = onSave ? onSave(valueRef.current) : valueRef.current;
        if (dataToSave !== undefined) {
          opfs.writeJson(key, dataToSave).catch(console.warn);
        }
      }
    };
  }, [key, onSave]);
  
  const flush = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    await save();
  }, [save]);
  
  return { value, setValue: setValueInternal, isLoaded, flush };
}
