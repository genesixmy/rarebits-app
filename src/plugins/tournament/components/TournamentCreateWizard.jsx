import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SwitchToggle } from '@/components/ui/switch-toggle';
import toast from 'react-hot-toast';
import TournamentTemplateSelector from '@/plugins/tournament/components/TournamentTemplateSelector';
import {
  BRACKET_TYPE_OPTIONS,
  getBracketTypeLabel,
  getRecommendedBracketType,
  normalizeTemplateConfig,
  TOURNAMENT_CREATE_STEPS,
} from '@/plugins/tournament/config/tournamentTemplates';
import { getMatchFormatDisplayLabel, MATCH_FORMAT_OPTIONS, normalizeMatchFormat } from '@/plugins/tournament/config/matchScoring';
import { useCreateTournament } from '@/plugins/tournament/hooks/useTournamentPlugin';
import { Loader2, Sparkles } from 'lucide-react';

const toDateTimeInputValue = (dateValue) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const buildInitialState = (template) => {
  const config = normalizeTemplateConfig(template);
  const initialMaxPlayers = config.recommendedParticipantSizes[0] || 8;
  const suggestedBracket = getRecommendedBracketType(
    template?.slug,
    initialMaxPlayers,
    config.recommendedBracketType
  );
  const bracketType = config.allowedBracketTypes.includes(suggestedBracket)
    ? suggestedBracket
    : config.allowedBracketTypes[0] || 'single_elimination';

  const dynamicSettings = { ...(config.defaultSettings || {}) };
  config.dynamicFormFields.forEach((field) => {
    if (dynamicSettings[field.key] === undefined) {
      dynamicSettings[field.key] = field.default ?? null;
    }
  });

  return {
    baseValues: {
      name: '',
      event_date: toDateTimeInputValue(new Date(Date.now() + (24 * 60 * 60 * 1000))),
      venue: '',
      entry_fee: '0',
      max_players: String(initialMaxPlayers),
      bracket_type: bracketType,
      match_format: normalizeMatchFormat(config.defaultMatchFormat),
      round_time_minutes: String(config.defaultRoundTimeMinutes),
      notes: '',
      category: template?.category || 'General',
      recommended_participant_sizes: config.recommendedParticipantSizes,
    },
    dynamicSettings,
    hasManualBracketOverride: false,
  };
};

const renderDynamicField = ({ field, value, onChange }) => {
  const fieldType = String(field.type || 'text').toLowerCase();

  if (fieldType === 'boolean') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-white p-3">
        <div>
          <p className="text-sm font-medium">{field.label}</p>
          <p className="text-xs text-muted-foreground">{field.description || 'Pilihan template'}</p>
        </div>
        <SwitchToggle
          checked={Boolean(value)}
          onCheckedChange={(next) => onChange(field.key, Boolean(next))}
        />
      </div>
    );
  }

  if (fieldType === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</label>
        <Select
          value={value ?? ''}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {options.map((optionValue) => (
            <option key={`${field.key}-${optionValue}`} value={optionValue}>
              {optionValue}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  if (fieldType === 'number') {
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</label>
        <Input
          type="number"
          value={value ?? ''}
          min={field.min ?? 0}
          max={field.max ?? undefined}
          onChange={(event) => onChange(field.key, event.target.value === '' ? '' : Number(event.target.value))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</label>
      <Input
        type="text"
        value={value ?? ''}
        placeholder={field.placeholder || ''}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    </div>
  );
};

const validateStepTwo = ({ template, baseValues, config }) => {
  if (!template?.id) return 'Template belum dipilih.';
  if (!String(baseValues.name || '').trim()) return 'Nama tournament wajib diisi.';
  if (!String(baseValues.event_date || '').trim()) return 'Tarikh event wajib diisi.';
  const parsedEventDate = new Date(baseValues.event_date);
  if (Number.isNaN(parsedEventDate.getTime())) return 'Tarikh event tidak sah.';

  const maxPlayers = Number.parseInt(baseValues.max_players, 10);
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2) return 'Max participants minimum ialah 2.';

  const roundTime = Number.parseInt(baseValues.round_time_minutes, 10);
  if (!Number.isFinite(roundTime) || roundTime < 1) return 'Round time minimum ialah 1 minit.';

  if (!config.allowedBracketTypes.includes(baseValues.bracket_type)) {
    return 'Bracket type tidak dibenarkan untuk template ini.';
  }

  return '';
};

const StepBadge = ({ step, active, completed }) => (
  <div
    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
      active
        ? 'border-primary bg-primary/10 text-primary'
        : completed
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-border bg-muted/40 text-muted-foreground'
    }`}
  >
    {step.id}. {step.title}
  </div>
);

const TournamentCreateWizard = ({ userId, templates, onCancel, onCreated }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [baseValues, setBaseValues] = useState(null);
  const [dynamicSettings, setDynamicSettings] = useState({});
  const [hasManualBracketOverride, setHasManualBracketOverride] = useState(false);
  const [stepError, setStepError] = useState('');
  const createMutation = useCreateTournament(userId);

  const templateConfig = useMemo(
    () => normalizeTemplateConfig(selectedTemplate),
    [selectedTemplate]
  );

  const bracketOptions = useMemo(
    () => BRACKET_TYPE_OPTIONS.filter((option) => templateConfig.allowedBracketTypes.includes(option.value)),
    [templateConfig.allowedBracketTypes]
  );

  const recommendedBracketType = useMemo(
    () => getRecommendedBracketType(
      selectedTemplate?.slug,
      Number.parseInt(baseValues?.max_players, 10),
      templateConfig.recommendedBracketType
    ),
    [baseValues?.max_players, selectedTemplate?.slug, templateConfig.recommendedBracketType]
  );

  useEffect(() => {
    if (!baseValues || hasManualBracketOverride) return;
    const nextBracketType = templateConfig.allowedBracketTypes.includes(recommendedBracketType)
      ? recommendedBracketType
      : (templateConfig.allowedBracketTypes[0] || templateConfig.recommendedBracketType);
    if (baseValues.bracket_type !== nextBracketType) {
      setBaseValues((prev) => ({ ...prev, bracket_type: nextBracketType }));
    }
  }, [
    baseValues,
    hasManualBracketOverride,
    recommendedBracketType,
    templateConfig.allowedBracketTypes,
    templateConfig.recommendedBracketType,
  ]);

  const handleTemplateSelect = (template) => {
    const initialState = buildInitialState(template);
    setSelectedTemplate(template);
    setBaseValues(initialState.baseValues);
    setDynamicSettings(initialState.dynamicSettings);
    setHasManualBracketOverride(false);
    setStepError('');
  };

  const handleBaseChange = (key, value) => {
    setBaseValues((prev) => ({ ...prev, [key]: value }));
    if (stepError) setStepError('');
  };

  const handleDynamicChange = (key, value) => {
    setDynamicSettings((prev) => ({ ...prev, [key]: value }));
    if (stepError) setStepError('');
  };

  const goNext = () => {
    if (currentStep === 1) {
      if (!selectedTemplate) {
        setStepError('Pilih template dahulu.');
        toast.error('Pilih template dahulu.');
        return;
      }
      setStepError('');
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      const validationError = validateStepTwo({
        template: selectedTemplate,
        baseValues,
        config: templateConfig,
      });
      if (validationError) {
        setStepError(validationError);
        toast.error(validationError);
        return;
      }
      setStepError('');
      setCurrentStep(3);
    }
  };

  const goBack = () => {
    setStepError('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreate = async () => {
    const validationError = validateStepTwo({
      template: selectedTemplate,
      baseValues,
      config: templateConfig,
    });
    if (validationError) {
      setStepError(validationError);
      toast.error(validationError);
      setCurrentStep(2);
      return;
    }

    try {
      const recommendationMeta = {
        rule: 'template_and_player_count',
        recommended_bracket_type: recommendedBracketType,
        selected_bracket_type: baseValues.bracket_type,
        max_players: Number.parseInt(baseValues.max_players, 10),
      };

      const created = await createMutation.mutateAsync({
        template: selectedTemplate,
        baseValues,
        dynamicSettings,
        recommendationMeta,
      });

      toast.success('Tournament berjaya dicipta.');
      onCreated?.(created);
    } catch (error) {
      const message = error?.message || 'Gagal cipta tournament.';
      toast.error(message);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Create New Tournament</CardTitle>
            <CardDescription>Fast setup menggunakan template premade.</CardDescription>
          </div>
          <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Wizard Mode
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TOURNAMENT_CREATE_STEPS.map((step) => (
            <StepBadge
              key={step.id}
              step={step}
              active={currentStep === step.id}
              completed={currentStep > step.id}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {currentStep === 1 ? (
          <TournamentTemplateSelector
            templates={templates}
            selectedTemplateId={selectedTemplate?.id}
            onSelectTemplate={handleTemplateSelect}
          />
        ) : null}

        {currentStep === 2 && selectedTemplate && baseValues ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-primary">Template: {selectedTemplate.name}</p>
              <p className="text-xs text-muted-foreground">
                Form sudah diprefill berdasarkan template. Anda boleh override ikut keperluan event.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tournament Name</label>
                <Input value={baseValues.name} onChange={(event) => handleBaseChange('name', event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event Date & Time</label>
                <Input
                  type="datetime-local"
                  value={baseValues.event_date}
                  onChange={(event) => handleBaseChange('event_date', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Venue</label>
                <Input value={baseValues.venue} onChange={(event) => handleBaseChange('venue', event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entry Fee (RM)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={baseValues.entry_fee}
                  onChange={(event) => handleBaseChange('entry_fee', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Max Participants</label>
                <Input
                  type="number"
                  min="2"
                  value={baseValues.max_players}
                  onChange={(event) => handleBaseChange('max_players', event.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {templateConfig.recommendedParticipantSizes.map((size) => (
                    <button
                      key={`preset-${size}`}
                      type="button"
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        Number(baseValues.max_players) === size
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-white text-muted-foreground'
                      }`}
                      onClick={() => handleBaseChange('max_players', String(size))}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bracket Type</label>
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Recommended: {getBracketTypeLabel(recommendedBracketType)}
                  </span>
                </div>
                <Select
                  value={baseValues.bracket_type}
                  onChange={(event) => {
                    setHasManualBracketOverride(true);
                    handleBaseChange('bracket_type', event.target.value);
                  }}
                >
                  {bracketOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Match Format</label>
                <Select
                  value={baseValues.match_format}
                  onChange={(event) => handleBaseChange('match_format', event.target.value)}
                >
                  {MATCH_FORMAT_OPTIONS.map((formatOption) => (
                    <option key={formatOption.value} value={formatOption.value}>
                      {formatOption.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Round Time (minutes)</label>
                <Input
                  type="number"
                  min="1"
                  value={baseValues.round_time_minutes}
                  onChange={(event) => handleBaseChange('round_time_minutes', event.target.value)}
                />
              </div>
            </div>

            {stepError ? (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {stepError}
              </div>
            ) : null}

            {templateConfig.dynamicFormFields.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold">Template Dynamic Fields</p>
                  <p className="text-xs text-muted-foreground">Opsyen tambahan ikut template dipilih.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {templateConfig.dynamicFormFields.map((field) => (
                    <div key={field.key}>
                      {renderDynamicField({
                        field,
                        value: dynamicSettings[field.key],
                        onChange: handleDynamicChange,
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes (Optional)</label>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm"
                value={baseValues.notes}
                onChange={(event) => handleBaseChange('notes', event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {currentStep === 3 && selectedTemplate && baseValues ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-semibold">Review Tournament Setup</p>
              <p className="text-xs text-muted-foreground">Semak dahulu sebelum create.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Template</p>
                <p className="font-semibold">{selectedTemplate.name}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Tournament Name</p>
                <p className="font-semibold">{baseValues.name || '-'}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Bracket</p>
                <p className="font-semibold">
                  {getBracketTypeLabel(baseValues.bracket_type)}
                  {baseValues.bracket_type === recommendedBracketType ? (
                    <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Recommended
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Max Players</p>
                <p className="font-semibold">{baseValues.max_players}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Match Format</p>
                <p className="font-semibold">{getMatchFormatDisplayLabel(baseValues.match_format)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Round Time</p>
                <p className="font-semibold">{baseValues.round_time_minutes} min</p>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-xs text-muted-foreground">Dynamic Settings Snapshot</p>
              {Object.keys(dynamicSettings).length === 0 ? (
                <p className="text-sm text-muted-foreground">Tiada dynamic settings.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {Object.entries(dynamicSettings).map(([key, value]) => (
                    <div key={key} className="rounded border border-primary/20 bg-primary/5 px-2 py-1 text-xs">
                      <span className="font-semibold">{key}</span>: {String(value)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            {currentStep > 1 ? (
              <Button type="button" variant="outline" onClick={goBack}>
                Back
              </Button>
            ) : null}
          </div>
          <div>
            {currentStep < 3 ? (
              <Button type="button" className="brand-gradient brand-gradient-hover text-white" onClick={goNext}>
                Next
              </Button>
            ) : (
              <Button
                type="button"
                className="brand-gradient brand-gradient-hover text-white"
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Create Tournament
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TournamentCreateWizard;
