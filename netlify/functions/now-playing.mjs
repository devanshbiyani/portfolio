// This is your secure serverless function
// It will run on a server, not in the browser

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

// The `Authorization` header must be a Base64 encoded string of "clientId:clientSecret"
const BASIC_TOKEN = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

// --- THIS IS THE CORRECTED ENDPOINT ---
const NOW_PLAYING_ENDPOINT = `https://api.spotify.com/v1/me/player/currently-playing';`;
const TOKEN_ENDPOINT = `https://accounts.spotify.com/api/token`;

// --- Helper Functions ---

/**
 * Gets a new Access Token from Spotify using the Refresh Token.
 */
async function getAccessToken() {
    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${BASIC_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: REFRESH_TOKEN,
        }),
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Spotify token API returned ${response.status}: ${JSON.stringify(data)}`);
    }
    return data;
}

/**
 * Fetches the user's currently playing track from Spotify.
 */
async function getNowPlaying() {
    const { access_token } = await getAccessToken();

    if (!access_token) {
        throw new Error('Could not get access token');
    }

    // This log will PROVE the new code is running.
    console.log('Attempting to fetch from Spotify endpoint:', NOW_PLAYING_ENDPOINT);

    const response = await fetch(NOW_PLAYING_ENDPOINT, {
        headers: {
            'Authorization': `Bearer ${access_token}`,
        },
    });

    // --- THIS IS THE NEW FIX ---
    // If response is 204, it means nothing is playing
    if (response.status === 204) {
        console.log('Spotify returned 204, nothing is playing.');
        return { isPlaying: false };
    }
    // If response is 404, it means no active device
    if (response.status === 404) {
        console.log('Spotify returned 404, no active device.');
        return { isPlaying: false };
    }
    // --- END NEW FIX ---
    
    // Handle *other* non-OK responses
    if (!response.ok) {
        throw new Error(`Spotify API returned ${response.status}`);
    }

    const song = await response.json();
    
    // Song is not playing or is a podcast
    if (!song.item || song.item.type !== 'track') {
        console.log('No track item found or item is not a track.');
        return { isPlaying: false };
    }

    // Format the data to send to the frontend
    return {
        isPlaying: song.is_playing,
        trackName: song.item.name,
        artistName: song.item.artists.map((artist) => artist.name).join(', '),
        albumArtUrl: song.item.album.images[0]?.url, // Get the largest album art
        songUrl: song.item.external_urls.spotify,
        progressMs: song.progress_ms,
        durationMs: song.item.duration_ms,
    };
}

// --- The Main Handler ---
export default async (req) => {
    try {
        const data = await getNowPlaying();
        
        // Return the data as JSON
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'cache-control': 'public, s-maxage=30, stale-while-revalidate=15',
            },
        });

    } catch (error) {
        console.error('Error in serverless function:', error.message);
        return new Response(JSON.stringify({ isPlaying: false, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};