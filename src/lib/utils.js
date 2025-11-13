

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
	return twMerge(clsx(inputs));
}

export function toSnakeCase(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(v => toSnakeCase(v));
  }

  return Object.keys(obj).reduce((acc, key) => {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    acc[snakeKey] = toSnakeCase(obj[key]);
    return acc;
  }, {});
}

/**
 * Format currency value to 2 decimal places
 * Handles any floating point precision issues and extra decimals
 * @param {number|string} value - The value to format
 * @returns {string} - Formatted value with exactly 2 decimal places, always X.XX format
 */
export function formatCurrency(value) {
  // Handle null, undefined, empty string
  if (value === null || value === undefined || value === '') {
    return '0.00';
  }
  
  // Convert to string and trim
  const strValue = String(value).trim();
  
  // Parse as float (this handles "140.000" -> 140, "140.00" -> 140, "59.1" -> 59.1, etc)
  const num = parseFloat(strValue);
  
  // Check if parsing failed
  if (isNaN(num)) {
    return '0.00';
  }
  
  // Round to 2 decimal places to avoid floating point issues
  const rounded = Math.round(num * 100) / 100;
  
  // Explicitly format: split into whole and decimal parts, then pad with zeros
  const parts = rounded.toString().split('.');
  const wholePart = parts[0];
  const decimalPart = (parts[1] || '0').padEnd(2, '0').substring(0, 2);
  
  return `${wholePart}.${decimalPart}`;
}

