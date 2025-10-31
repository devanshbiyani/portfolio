// Vercel Configuration block has been REMOVED to fix the "Buffer is not defined" error.
// The function will now run in a standard Node.js environment.

// This is your secure serverless function
// It will run on a server, not in the browser

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

// The `Authorization` header must be a Base64 encoded string of "clientId:clientSecret"
// This line REQUIRES Node.js and will crash in the Vercel "Edge" runtime.
const BASIC_TOKEN = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';
const RECENTLY_PLAYED_ENDPOINT = 'https://api.spotify.com/v1/me/player/recently-played';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

// --- Helper Functions ---

/**
 * Gets a new Access Token from Spotify using the Refresh Token.
 */
async function getAccessToken() {
    console.log('--- [LOG] 1. Getting Access Token...');
    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('refresh_token', REFRESH_TOKEN);

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${BASIC_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    
    const data = await response.json();
    if (!response.ok) {
        console.error('--- [ERROR] Failed to get Access Token:', data);
        throw new Error(`Spotify token API returned ${response.status}: ${JSON.stringify(data)}`);
    }
    console.log('--- [LOG] 2. Access Token received.');
    return data;
}

/**
 * Fetches the user's currently playing track from Spotify.
 * If nothing is playing, it fetches the most recently played track.
 */
async function getNowPlaying() {
    const { access_token } = await getAccessToken();

    if (!access_token) {
        throw new Error('Could not get access token');
    }

    // --- 1. Check for Currently Playing Track ---
    console.log('--- [LOG] 3. Checking for currently playing track...');
    const nowPlayingResponse = await fetch(NOW_PLAYING_ENDPOINT, {
        headers: {
            'Authorization': `Bearer ${access_token}`,
        },
    });
    console.log(`--- [LOG] 4. Currently playing status: ${nowPlayingResponse.status}`);


    // If status is 200 and a song is actively playing
    if (nowPlayingResponse.status === 200) {
        const song = await nowPlayingResponse.json();
        if (song && song.is_playing && song.item && song.item.type === 'track') {
            console.log('--- [LOG] 5a. Found actively playing track.');
            return {
                status: 'playing',
                isPlaying: song.is_playing,
                trackName: song.item.name,
                artistName: song.item.artists.map((artist) => artist.name).join(', '),
                albumArtUrl: song.item.album.images[0]?.url,
                songUrl: song.item.external_urls.spotify,
                progressMs: song.progress_ms,
                durationMs: song.item.duration_ms,
            };
        }
    }
    
    // --- 2. If Nothing is Playing, Check for Recently Played ---
    console.log('--- [LOG] 5b. Nothing playing, checking recently played.');
    const recentResponse = await fetch(`${RECENTLY_PLAYED_ENDPOINT}?limit=1`, {
        headers: {
            'Authorization': `Bearer ${access_token}`,
        },
    });
    console.log(`--- [LOG] 6. Recently played status: ${recentResponse.status}`);


    if (!recentResponse.ok) {
        console.error(`--- [ERROR] Spotify recent-played API returned ${recentResponse.status}`);
        return { status: 'offline', isPlaying: false };
    }

    console.log('--- [LOG] 7. Parsing recently played JSON...');
    const recentData = await recentResponse.json();
    const lastTrack = recentData.items[0]?.track;

    if (lastTrack) {
        console.log('--- [LOG] 8a. Found last played track.');
        return {
            status: 'last_played',
            isPlaying: false, // It's not *currently* playing
            trackName: lastTrack.name,
            artistName: lastTrack.artists.map((artist) => artist.name).join(', '),
            albumArtUrl: lastTrack.album.images[0]?.url,
            songUrl: lastTrack.external_urls.spotify,
            progressMs: 0, // No progress
            durationMs: lastTrack.duration_ms,
        };
    }

    // --- 3. If no data at all, return offline ---
    console.log('--- [LOG] 8b. No recently played track found.');
    return { status: 'offline', isPlaying: false };
}

// --- The Main Handler ---
// THIS BLOCK IS NOW FIXED to use the standard Node.js serverless signature
// `req` (or `request`) is the incoming request
// `res` (or `response`) is the outgoing response
export default async (req, res) => {
    try {
        console.log('--- [LOG] API call received ---');
        const data = await getNowPlaying();
        
        // --- THIS IS THE FIX ---
        // Set cache headers
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('cache-control', 'public, s-maxage=10, stale-while-revalidate=5');
        
        // Return data using the Node.js `response.json()` method
        return res.status(200).json(data);
        // --- END OF FIX ---

    } catch (error) {
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        console.error('--- [FATAL ERROR] Error in serverless function:', errorMessage);
        
        // --- THIS IS THE FIX (for errors) ---
        return res.status(500).json({ status: 'error', isPlaying: false, error: errorMessage });
        // --- END OF FIX ---
    }
};

