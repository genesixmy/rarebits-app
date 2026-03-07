import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getBracketTypeLabel, normalizeTemplateConfig } from '@/plugins/tournament/config/tournamentTemplates';
import { Sparkles, Trophy } from 'lucide-react';

const TournamentTemplateSelector = ({ templates, selectedTemplateId, onSelectTemplate }) => {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">Step 1 - Choose Tournament Template</p>
        <p className="text-sm text-muted-foreground">
          Pilih template untuk prefill setting asas. Anda masih boleh ubah sebelum create.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {templates.map((template) => {
          const config = normalizeTemplateConfig(template);
          const selected = selectedTemplateId === template.id;

          return (
            <Card
              key={template.id}
              className={`border transition-all ${selected ? 'border-primary shadow-sm ring-1 ring-primary/30' : 'border-primary/20'}`}
            >
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {template.category}
                  </span>
                  {selected ? (
                    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      Selected
                    </span>
                  ) : null}
                </div>
                <div className="flex items-start gap-2">
                  <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
                    <Trophy className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{template.name}</CardTitle>
                    <CardDescription className="mt-1">{template.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Recommended Bracket</p>
                  <p className="text-sm font-semibold">{getBracketTypeLabel(config.recommendedBracketType)}</p>
                </div>

                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Participant Size</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {config.recommendedParticipantSizes.length > 0 ? (
                      config.recommendedParticipantSizes.map((size) => (
                        <span key={`${template.id}-${size}`} className="rounded-full border border-primary/20 bg-white px-2 py-0.5 text-xs">
                          {size}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">Flexible</span>
                    )}
                  </div>
                </div>

                <Button
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  className={selected ? 'w-full brand-gradient brand-gradient-hover text-white' : 'w-full'}
                  onClick={() => onSelectTemplate(template)}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {selected ? 'Template Selected' : 'Use Template'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TournamentTemplateSelector;

