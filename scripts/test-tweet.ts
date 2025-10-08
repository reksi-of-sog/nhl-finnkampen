import 'dotenv/config'; // To load environment variables from .env
import { TwitterApi } from 'twitter-api-v2';

async function testTweet() {
  console.log('--- Starting Twitter Test Tweet ---');

  // Check if TWITTER_ENABLE is set to '1'
  if (process.env.TWITTER_ENABLE !== '1') {
    console.log('TWITTER_ENABLE is not set to "1". Skipping tweet attempt.');
    console.log(`Current TWITTER_ENABLE: "${process.env.TWITTER_ENABLE}"`);
    return;
  }

  // Check for all required credentials
  const appKey = process.env.TWITTER_APP_KEY;
  const appSecret = process.env.TWITTER_APP_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    console.error('ERROR: One or more Twitter API credentials are missing from environment variables.');
    console.error(`TWITTER_APP_KEY: ${appKey ? 'SET' : 'MISSING'}`);
    console.error(`TWITTER_APP_SECRET: ${appSecret ? 'SET' : 'MISSING'}`);
    console.error(`TWITTER_ACCESS_TOKEN: ${accessToken ? 'SET' : 'MISSING'}`);
    console.error(`TWITTER_ACCESS_SECRET: ${accessSecret ? 'SET' : 'MISSING'}`);
    return;
  }

  console.log('All Twitter API credentials appear to be set.');

  try {
    const client = new TwitterApi({
      appKey: appKey,
      appSecret: appSecret,
      accessToken: accessToken,
      accessSecret: accessSecret,
    });
    console.log('Twitter client initialized successfully.');

    const testMessage = `Testing tweet from NHL bot at ${new Date().toISOString()}. If you see this, it worked! #NHLTest`;
    console.log(`Attempting to send tweet: "${testMessage}"`);

    const { data: tweetResponse } = await client.v2.tweet(testMessage);
    console.log('Tweet sent successfully!');
    console.log('Tweet ID:', tweetResponse.id);
    console.log('Tweet Text:', tweetResponse.text);
  } catch (error) {
    console.error('ERROR: Failed to send tweet.');
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      if ('code' in error) console.error('Error code:', (error as any).code);
      if ('data' in error) console.error('Error data:', (error as any).data);
      if ('rateLimit' in error) console.error('Rate Limit Info:', (error as any).rateLimit);
    } else {
      console.error('Unknown error:', error);
    }
  } finally {
    console.log('--- Finished Twitter Test Tweet ---');
  }
}

testTweet().catch(console.error);