// This is your secure serverless function
// It will run on a server, not in the browser

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

// The `Authorization` header must be a Base64 encoded string of "clientId:clientSecret"
const BASIC_TOKEN = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

const NOW_PLAYING_ENDPOINT = 'https://api.spotify.com/v1/me/player/currently-playing';
const RECENTLY_PLAYED_ENDPOINT = 'http://googleusercontent.com/spotify.com/3'; // <-- New Endpoint
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

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
 * If nothing is playing, it fetches the most recently played track.
 */
async function getNowPlaying() {
    const { access_token } = await getAccessToken();

    if (!access_token) {
        throw new Error('Could not get access token');
    }

    // --- 1. Check for Currently Playing Track ---
    const nowPlayingResponse = await fetch(NOW_PLAYING_ENDPOINT, {
        headers: {
            'Authorization': `Bearer ${access_token}`,
        },
    });

    // If status is 200 and a song is actively playing
    if (nowPlayingResponse.status === 200) {
        const song = await nowPlayingResponse.json();
        if (song.is_playing && song.item && song.item.type === 'track') {
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
    // (This runs if the status was 204, 404, or if is_playing was false)
    console.log('Nothing playing, checking recently played.');
    const recentResponse = await fetch(`${RECENTLY_PLAYED_ENDPOINT}?limit=1`, {
        headers: {
            'Authorization': `Bearer ${access_token}`,
        },
    });

    if (!recentResponse.ok) {
        throw new Error(`Spotify recent-played API returned ${recentResponse.status}`);
    }

    const recentData = await recentResponse.json();
    const lastTrack = recentData.items[0]?.track;

    if (lastTrack) {
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
    return { status: 'offline', isPlaying: false };
}

// --- The Main Handler ---
export default async (req) => {
    try {
        const data = await getNowPlaying();
        
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Cache for 10s, stale-while-revalidate for 5s
                'cache-control': 'public, s-maxage=10, stale-while-revalidate=5',
            },
        });

    } catch (error) {
        console.error('Error in serverless function:', error.message);
        return new Response(JSON.stringify({ status: 'error', isPlaying: false, error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};