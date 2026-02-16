import { useState, useEffect } from 'react';
import {
  DetectExperimentalFeatures,
  GetExperimentalFeatureDefinitions,
} from '../../../wailsjs/go/main/App';
import type { ExperimentalFeatureDefinition, ExperimentalFeatureStatus } from './types';

interface ExperimentalTabContentProps {
  folder: string;
  experimentalFeatures: Record<string, boolean>;
  onToggleFeature: (featureId: string, enabled: boolean) => void;
}

export function ExperimentalTabContent({
  folder,
  experimentalFeatures,
  onToggleFeature,
}: ExperimentalTabContentProps) {
  const [statuses, setStatuses] = useState<ExperimentalFeatureStatus[]>([]);
  const [definitions, setDefinitions] = useState<ExperimentalFeatureDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFeatureData();
  }, [folder]);

  const loadFeatureData = async () => {
    setLoading(true);
    try {
      const [defs, detectedStatuses] = await Promise.all([
        GetExperimentalFeatureDefinitions(),
        DetectExperimentalFeatures(folder),
      ]);

      // Convert Wails classes to plain objects
      const plainDefs: ExperimentalFeatureDefinition[] = (defs || []).map(d => ({
        id: d.id,
        name: d.name,
        description: d.description,
        envVar: d.envVar,
        tools: d.tools || [],
      }));

      const plainStatuses: ExperimentalFeatureStatus[] = (detectedStatuses || []).map(s => ({
        feature: {
          id: s.feature?.id || '',
          name: s.feature?.name || '',
          description: s.feature?.description || '',
          envVar: s.feature?.envVar || '',
          tools: s.feature?.tools || [],
        },
        detected: s.detected || false,
        source: s.source || 'none',
      }));

      setDefinitions(plainDefs);
      setStatuses(plainStatuses);
    } catch (err) {
      console.error('Failed to load experimental features:', err);
    } finally {
      setLoading(false);
    }
  };

  const getSourceLabel = (source: string): string => {
    switch (source) {
      case 'project': return 'Detected in project settings';
      case 'global': return 'Detected in global settings';
      case 'env': return 'Detected in environment';
      default: return 'Not detected';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: '#666', textAlign: 'center' }}>
        Loading experimental features...
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Description */}
      <div style={{
        fontSize: '0.8rem',
        color: '#666',
        lineHeight: 1.5,
      }}>
        Experimental Claude Code features gated behind environment variables.
        Enabling a feature adds its tools to the CLI flags and sets the env var
        in the project's <code style={{
          background: '#1a1a1a',
          padding: '0.1rem 0.3rem',
          borderRadius: '3px',
          fontSize: '0.75rem',
        }}>.claude/settings.local.json</code>.
      </div>

      {/* Feature cards */}
      {definitions.map(def => {
        const status = statuses.find(s => s.feature.id === def.id);
        const isEnabled = experimentalFeatures[def.id] || false;
        const isDetected = status?.detected || false;
        const source = status?.source || 'none';

        return (
          <div
            key={def.id}
            style={{
              border: `1px solid ${isEnabled ? '#4a3420' : '#2a2a2a'}`,
              borderRadius: '8px',
              background: isEnabled ? '#1a1208' : '#0d0d0d',
              overflow: 'hidden',
            }}
          >
            {/* Header row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {/* Feature icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isEnabled ? '#d97757' : '#555'} strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <div>
                  <div style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: isEnabled ? '#e8e8e8' : '#aaa',
                  }}>
                    {def.name}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#666',
                    marginTop: '0.15rem',
                  }}>
                    {def.description}
                  </div>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => onToggleFeature(def.id, !isEnabled)}
                style={{
                  width: '40px',
                  height: '22px',
                  borderRadius: '11px',
                  border: 'none',
                  background: isEnabled ? '#d97757' : '#333',
                  cursor: 'pointer',
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '3px',
                  left: isEnabled ? '21px' : '3px',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>

            {/* Details section */}
            <div style={{
              padding: '0 1rem 0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              {/* Detection status */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: isDetected ? '#5d9e6e' : '#555',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: '0.75rem',
                  color: isDetected ? '#5d9e6e' : '#555',
                }}>
                  {getSourceLabel(source)}
                </span>
              </div>

              {/* Env var name */}
              <div style={{
                fontSize: '0.72rem',
                color: '#555',
                fontFamily: 'monospace',
              }}>
                {def.envVar}
              </div>

              {/* Tools list */}
              <div style={{ marginTop: '0.25rem' }}>
                <div style={{
                  fontSize: '0.72rem',
                  color: '#666',
                  marginBottom: '0.35rem',
                }}>
                  Tools unlocked ({def.tools.length}):
                </div>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.3rem',
                }}>
                  {def.tools.map(tool => (
                    <span
                      key={tool}
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: isEnabled ? '#1f1a14' : '#1a1a1a',
                        border: `1px solid ${isEnabled ? '#3a2a1a' : '#2a2a2a'}`,
                        fontSize: '0.7rem',
                        fontFamily: 'monospace',
                        color: isEnabled ? '#d97757' : '#666',
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {definitions.length === 0 && (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: '#555',
          fontSize: '0.85rem',
        }}>
          No experimental features available
        </div>
      )}
    </div>
  );
}
