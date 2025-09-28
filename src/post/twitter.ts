// src/post/twitter.ts
import { TwitterApi } from 'twitter-api-v2';

export async function postTweet(text: string) {
  if (process.env.TWITTER_ENABLE !== '1') {
    console.log('[post] Skipped (TWITTER_ENABLE!=1):\n', text);
    return { skipped: true };
  }

  const client = new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY!,
    appSecret: process.env.TWITTER_APP_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });

  const { data } = await client.v2.tweet(text);
  console.log('[post] Tweeted id=', data.id);
  return data;
}
