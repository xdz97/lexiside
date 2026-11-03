import { describe, expect, it } from 'vitest';
import { chooseVoice, listEnglishVoices, speechText } from './tts';

const voices = [
  { voiceName: 'English Compact', lang: 'en-US', remote: false },
  { voiceName: 'Daniel', lang: 'en-GB', remote: false, eventTypes: ['end'] },
  { voiceName: 'Google US English', lang: 'en-US', remote: true, eventTypes: ['end'] },
  { voiceName: 'Ava (Premium)', lang: 'en-US', remote: false, eventTypes: ['end'] },
  { voiceName: 'David', lang: 'en-US', remote: false, eventTypes: ['end'] },
];

describe('TTS voice selection', () => {
  it('prefers a high-quality exact-locale voice in automatic mode', () => {
    expect(chooseVoice(voices, { voice: 'en-US', voiceName: 'auto', voiceGenderPreference: 'auto' })?.voiceName)
      .toBe('Ava (Premium)');
  });

  it('honors an explicitly selected installed voice', () => {
    expect(chooseVoice(voices, { voice: 'en-US', voiceName: 'Daniel', voiceGenderPreference: 'female' })?.voiceName)
      .toBe('Daniel');
  });

  it('keeps the requested accent ahead of a premium voice from another locale', () => {
    expect(chooseVoice(voices, { voice: 'en-GB', voiceName: 'auto', voiceGenderPreference: 'auto' })?.voiceName)
      .toBe('Daniel');
  });

  it('applies gender preference within the requested accent', () => {
    expect(chooseVoice(voices, { voice: 'en-US', voiceName: 'auto', voiceGenderPreference: 'male' })?.voiceName)
      .toBe('David');
    expect(chooseVoice(voices, { voice: 'en-US', voiceName: 'auto', voiceGenderPreference: 'female' })?.voiceName)
      .toBe('Ava (Premium)');
  });

  it('marks inferred gender in the voice list', () => {
    const listed = listEnglishVoices(voices, 'en-US', 'female');
    expect(listed.find((voice) => voice.voiceName === 'Ava (Premium)')?.gender).toBe('female');
    expect(listed.find((voice) => voice.voiceName === 'Daniel')?.gender).toBe('male');
    expect(listed.find((voice) => voice.voiceName === 'Google US English')?.gender).toBe('unknown');
  });

  it('marks a single recommended voice and ranks weak voices below strong voices of the same accent', () => {
    const listed = listEnglishVoices(voices, 'en-US');
    expect(listed.filter((voice) => voice.recommended)).toHaveLength(1);
    expect(listed.findIndex((voice) => voice.voiceName === 'English Compact'))
      .toBeGreaterThan(listed.findIndex((voice) => voice.voiceName === 'Google US English'));
  });
});

describe('speech text', () => {
  it('uses sentence context to preserve contextual stress', () => {
    expect(speechText('records', 'The app records your progress.', 'sentence'))
      .toBe('The app records your progress.');
  });

  it('keeps isolated-word playback when requested', () => {
    expect(speechText('  records ', 'The app records your progress.', 'word')).toBe('records');
  });
});
