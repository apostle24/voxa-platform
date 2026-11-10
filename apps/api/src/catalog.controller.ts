import { Controller, Get, Param } from '@nestjs/common';

type DemoEpisode = {
  id: string;
  title: string;
  show: string;
  description: string;
  durationSeconds: number;
  mediaStatus: 'placeholder';
};

const episodes: DemoEpisode[] = [
  {
    id: 'ep-wellbeing-001',
    title: 'Building a life of intentional growth',
    show: 'The VOXA Sessions',
    description: 'A sample catalogue record for local development.',
    durationSeconds: 1840,
    mediaStatus: 'placeholder',
  },
  {
    id: 'ep-ideas-002',
    title: 'Ideas that bring people together',
    show: 'Open Conversations',
    description: 'A sample catalogue record for local development.',
    durationSeconds: 2260,
    mediaStatus: 'placeholder',
  },
];

@Controller('catalog')
export class CatalogController {
  @Get('episodes')
  listEpisodes() {
    return { items: episodes, nextCursor: null };
  }

  @Get('episodes/:id')
  getEpisode(@Param('id') id: string) {
    const episode = episodes.find((item) => item.id === id);
    return episode ?? { error: 'not_found', id };
  }
}
