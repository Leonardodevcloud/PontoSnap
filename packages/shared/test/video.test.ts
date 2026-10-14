import { describe, expect, it } from 'vitest';
import { reconhecerVideo } from '../src/video';

describe('reconhecerVideo', () => {
  it('YouTube em todos os formatos de link', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=x',
    ]) {
      const v = reconhecerVideo(url);
      expect(v?.provedor, url).toBe('YOUTUBE');
      expect(v?.videoId, url).toBe('dQw4w9WgXcQ');
    }
    expect(reconhecerVideo('https://youtu.be/dQw4w9WgXcQ')?.embed).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
  it('Vimeo e Google Drive', () => {
    expect(reconhecerVideo('https://vimeo.com/76979871')).toMatchObject({ provedor: 'VIMEO', videoId: '76979871' });
    expect(reconhecerVideo('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'))
      .toMatchObject({ provedor: 'DRIVE', videoId: '1AbCdEfGhIjKlMnOp', embed: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview' });
  });
  it('recusa o resto', () => {
    expect(reconhecerVideo('')).toBeNull();
    expect(reconhecerVideo('https://example.com/video.mp4')).toBeNull();
    expect(reconhecerVideo('https://www.youtube.com/@canal')).toBeNull();
    expect(reconhecerVideo('não é link')).toBeNull();
  });
});
