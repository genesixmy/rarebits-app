import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

const InvoiceShareRedirectPage = () => {
  const { shareCode } = useParams();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Sedang menyediakan invois...');

  useEffect(() => {
    const run = async () => {
      const code = typeof shareCode === 'string' ? shareCode.trim() : '';
      if (!code) {
        setStatus('error');
        setMessage('Link invois tidak sah.');
        return;
      }

      const { data, error } = await supabase.rpc('resolve_invoice_share_link', {
        p_short_code: code,
      });

      if (error) {
        console.error('[InvoiceShareRedirectPage] resolve link failed:', error);
        setStatus('error');
        setMessage('Link invois tidak sah atau tamat tempoh.');
        return;
      }

      const row = Array.isArray(data) ? data[0] : null;
      const targetUrl = row?.target_url;
      if (!targetUrl) {
        setStatus('error');
        setMessage('Link invois tidak sah atau tamat tempoh.');
        return;
      }

      setStatus('ready');
      setMessage('Membuka invois...');
      window.location.replace(targetUrl);
    };

    run();
  }, [shareCode]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {status === 'loading' || status === 'ready' ? (
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-slate-500" />
        ) : (
          <div className="mx-auto mb-4 h-8 w-8 rounded-full bg-rose-100 text-rose-600 leading-8">!</div>
        )}
        <h1 className="text-lg font-semibold text-slate-900">RareBits Invoice Link</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
    </div>
  );
};

export default InvoiceShareRedirectPage;

