import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Puzzle, ShieldCheck, ArrowRight } from 'lucide-react';
import { getAvailablePlugins, canAccessPlugin } from '@/plugins/runtime/pluginRuntime';
import { PLUGIN_STATUS, PLUGIN_STATUS_LABEL } from '@/plugins/shared/pluginLifecycle';

const statusClassMap = {
  [PLUGIN_STATUS.COMING_SOON]: 'border-amber-300 bg-amber-50 text-amber-700',
  [PLUGIN_STATUS.AVAILABLE]: 'border-cyan-300 bg-cyan-50 text-cyan-700',
  [PLUGIN_STATUS.ENABLED]: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  [PLUGIN_STATUS.DISABLED]: 'border-slate-300 bg-slate-100 text-slate-600',
};

const PluginsPage = () => {
  const plugins = getAvailablePlugins();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary/20 bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="page-title mb-1">Plugin Center</h1>
            <p className="text-sm text-muted-foreground">
              Semua plugin dibina dalam modul berasingan. Core RareBits tidak diubah secara terus.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Isolated Mode Enabled
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plugins.map((plugin) => (
          <Card key={plugin.id} className="border-primary/20">
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{plugin.name}</CardTitle>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClassMap[plugin.status] || statusClassMap.disabled}`}
                >
                  {PLUGIN_STATUS_LABEL[plugin.status] || plugin.status}
                </span>
              </div>
              <CardDescription>{plugin.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Version</p>
                <p className="text-sm font-semibold">{plugin.version}</p>
              </div>

              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Harga</p>
                <p className="text-sm font-semibold">
                  {plugin.price?.amount > 0
                    ? `${plugin.price.currency} ${plugin.price.amount.toFixed(2)}`
                    : (plugin.price?.label || 'Included')}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Roadmap Dalam Plugin</p>
                <ul className="space-y-1 text-sm text-foreground/90">
                  {plugin.capabilities.map((capability) => (
                    <li key={capability}>- {capability}</li>
                  ))}
                </ul>
              </div>

              {canAccessPlugin(plugin.slug) ? (
                <Button asChild className="w-full brand-gradient brand-gradient-hover text-white">
                  <Link to={plugin.route}>
                    Buka Plugin
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button type="button" className="w-full" variant="outline" disabled>
                  {plugin.status === PLUGIN_STATUS.COMING_SOON ? 'Coming Soon' : 'Tidak Tersedia'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {plugins.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Tiada plugin aktif buat masa ini.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default PluginsPage;
