import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { getPluginAccessState } from '@/plugins/runtime/pluginRuntime';

const accessMessageMap = {
  not_found: 'Plugin tidak dijumpai dalam registry.',
  disabled: 'Plugin ini dimatikan (kill switch aktif).',
  coming_soon: 'Plugin ini belum dibuka untuk penggunaan.',
  purchase_required: 'Plugin ini memerlukan pembelian sebelum akses.',
  denied: 'Akses plugin disekat.',
};

const PluginUnavailablePage = ({ pluginSlug }) => {
  const accessState = getPluginAccessState(pluginSlug);
  const pluginName = accessState.plugin?.name || 'Plugin';
  const reason = accessState.reason || 'denied';
  const message = accessMessageMap[reason] || accessMessageMap.denied;

  return (
    <div className="space-y-5">
      <Button asChild variant="outline" size="sm">
        <Link to="/plugins">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Kembali Ke Plugin Center
        </Link>
      </Button>

      <Card className="border-amber-300">
        <CardHeader>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <CardTitle>{pluginName} tidak tersedia</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Akses plugin dikawal melalui manifest status di plugin runtime layer supaya core RareBits kekal stabil.
        </CardContent>
      </Card>
    </div>
  );
};

export default PluginUnavailablePage;

