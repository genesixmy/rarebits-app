-- Allow nullable client_id in invoices table for guest invoices
-- Simply alter the column to allow NULL values

ALTER TABLE public.invoices
ALTER COLUMN client_id DROP NOT NULL;
