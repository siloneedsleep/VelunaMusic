use crate::ytmusic::client::{InnerTubeClient, InnerTubeClientKind};
use crate::ytmusic::models::{
    AlbumDetail, AlbumRef, ArtistDetail, ArtistRef, HomeItem, HomeItemKind, HomeMoodChip,
    HomeResponse, HomeShelf, LyricLine, LyricWord, LyricsResult, RecordingKind, SearchResponse,
    YtmAlbumSummary, YtmArtistSummary, YtmError, YtmTrack,
};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::OnceLock;

const SIMPMUSIC_LYRICS_UA: &str = "SimpMusicLyrics/1.0";

pub fn classify_recording_kind(
    title: &str,
    subtitle: &str,
    has_live_badge: bool,
    video_type: Option<&str>,
) -> RecordingKind {
    if has_live_badge {
        return RecordingKind::Live;
    }
    static LIVE_RE: OnceLock<Regex> = OnceLock::new();
    static REMIX_RE: OnceLock<Regex> = OnceLock::new();
    static KARAOKE_RE: OnceLock<Regex> = OnceLock::new();
    static COVER_RE: OnceLock<Regex> = OnceLock::new();
    static INST_RE: OnceLock<Regex> = OnceLock::new();

    let live_re = LIVE_RE.get_or_init(|| {
        Regex::new(r"(?i)(?:\blive\b|\btrực tiếp\b|\bunplugged\b|\bconcert\b|\blive at\b|\blive from\b|\bin concert\b)")
            .expect("live re")
    });
    let remix_re = REMIX_RE.get_or_init(|| {
        Regex::new(r"(?i)(?:\bremix\b|\bvip mix\b|\bbootleg\b|\bmashup\b|\brework\b|\bclub mix\b|\bextended mix\b|\bslowed\b|\bsped up\b|\bnightcore\b|\blofi mix\b)")
            .expect("remix re")
    });
    let karaoke_re = KARAOKE_RE.get_or_init(|| Regex::new(r"(?i)\bkaraoke\b").expect("karaoke re"));
    let cover_re = COVER_RE.get_or_init(|| Regex::new(r"(?i)\bcover\b").expect("cover re"));
    let inst_re = INST_RE.get_or_init(|| {
        Regex::new(r"(?i)(?:\binstrumental\b|\boff vocal\b|\bbeat version\b|\binst\.?\b)")
            .expect("inst re")
    });

    let combined = format!("{} {}", title, subtitle);
    if remix_re.is_match(&combined) {
        return RecordingKind::Remix;
    }
    if live_re.is_match(&combined) {
        return RecordingKind::Live;
    }
    if karaoke_re.is_match(&combined) {
        return RecordingKind::Karaoke;
    }
    if cover_re.is_match(&combined) {
        return RecordingKind::Cover;
    }
    if inst_re.is_match(&combined) {
        return RecordingKind::Instrumental;
    }
    if matches!(video_type, Some("MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK")) {
        return RecordingKind::Original;
    }
    RecordingKind::Original
}

pub fn parse_duration_sec(text: &str) -> Option<u64> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !trimmed.contains(':') {
        return None;
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() == 2 {
        let m = parts[0].trim().parse::<u64>().ok()?;
        let s = parts[1].trim().parse::<u64>().ok()?;
        Some(m * 60 + s)
    } else if parts.len() == 3 {
        let h = parts[0].trim().parse::<u64>().ok()?;
        let m = parts[1].trim().parse::<u64>().ok()?;
        let s = parts[2].trim().parse::<u64>().ok()?;
        Some(h * 3600 + m * 60 + s)
    } else {
        None
    }
}

fn runs_text(val: Option<&Value>) -> String {
    let Some(v) = val else {
        return String::new();
    };
    if let Some(s) = v.get("simpleText").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    if let Some(arr) = v.get("runs").and_then(|x| x.as_array()) {
        let mut out = String::new();
        for run in arr {
            if let Some(t) = run.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
        return out;
    }
    String::new()
}

fn upgrade_thumbnail_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    static SQUARE_SIZE_RE: OnceLock<Regex> = OnceLock::new();
    let re = SQUARE_SIZE_RE
        .get_or_init(|| Regex::new(r"=w(\d+)-h(\d+)(-[^&?]*)?$").expect("thumb size re"));
    if trimmed.contains("lh3.googleusercontent.com") {
        if let Some(caps) = re.captures(trimmed) {
            let w = caps[1].parse::<u32>().unwrap_or(0);
            let h = caps[2].parse::<u32>().unwrap_or(0);
            if w > 0 && w == h && w < 544 {
                return re.replace(trimmed, "=w544-h544-l90-rj").into_owned();
            }
        }
    }
    trimmed.to_string()
}

fn best_thumbnail(val: Option<&Value>) -> String {
    let Some(v) = val else {
        return String::new();
    };
    let arr = v
        .get("musicThumbnailRenderer")
        .and_then(|r| r.get("thumbnail"))
        .and_then(|t| t.get("thumbnails"))
        .or_else(|| v.get("thumbnail").and_then(|t| t.get("thumbnails")))
        .or_else(|| v.get("thumbnails"))
        .and_then(|t| t.as_array());
    let Some(list) = arr else {
        return String::new();
    };
    let best = list
        .iter()
        .filter_map(|item| {
            let url = item.get("url").and_then(|u| u.as_str())?;
            let width = item.get("width").and_then(|w| w.as_u64()).unwrap_or(0);
            Some((width, url))
        })
        .max_by_key(|(w, _)| *w)
        .map(|(_, url)| url)
        .unwrap_or("");
    upgrade_thumbnail_url(best)
}

fn thumbnails_from(val: Option<&Value>) -> Vec<String> {
    let Some(v) = val else {
        return Vec::new();
    };
    let arr = v
        .get("musicThumbnailRenderer")
        .and_then(|r| r.get("thumbnail"))
        .and_then(|t| t.get("thumbnails"))
        .or_else(|| v.get("thumbnails"))
        .and_then(|t| t.as_array());
    let Some(list) = arr else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|item| {
            item.get("url")
                .and_then(|u| u.as_str())
                .map(|s| s.to_string())
        })
        .collect()
}

fn has_explicit_badge(item: &Value) -> bool {
    item.get("badges")
        .and_then(|b| b.as_array())
        .map(|arr| {
            arr.iter().any(|badge| {
                badge
                    .get("musicInlineBadgeRenderer")
                    .and_then(|r| r.get("icon"))
                    .and_then(|i| i.get("iconType"))
                    .and_then(|t| t.as_str())
                    == Some("MUSIC_EXPLICIT_BADGE")
            })
        })
        .unwrap_or(false)
}

fn has_live_badge(item: &Value) -> bool {
    item.get("badges")
        .and_then(|b| b.as_array())
        .map(|arr| {
            arr.iter().any(|badge| {
                badge.get("liveBadgeRenderer").is_some()
                    || runs_text(
                        badge
                            .get("musicInlineBadgeRenderer")
                            .and_then(|r| r.get("accessibilityData")),
                    )
                    .to_ascii_lowercase()
                    .contains("live")
            })
        })
        .unwrap_or(false)
}

fn extract_nav_id(nav: Option<&Value>) -> (Option<String>, Option<String>, Option<String>) {
    let Some(n) = nav else {
        return (None, None, None);
    };
    let watch_vid = n
        .get("watchEndpoint")
        .and_then(|w| w.get("videoId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let watch_vtype = n
        .get("watchEndpoint")
        .and_then(|w| w.get("watchEndpointMusicSupportedConfigs"))
        .and_then(|c| c.get("watchEndpointMusicConfig"))
        .and_then(|m| m.get("musicVideoType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let browse_id = n
        .get("browseEndpoint")
        .and_then(|b| b.get("browseId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (watch_vid, browse_id, watch_vtype)
}

struct TrackFields<'a> {
    video_id: String,
    title: String,
    artists: Vec<ArtistRef>,
    album: Option<AlbumRef>,
    duration_text: Option<String>,
    subtitle_for_kind: &'a str,
    thumbnails: Vec<String>,
    is_explicit: bool,
    live_badge: bool,
    video_type: Option<&'a str>,
}

fn build_track(fields: TrackFields<'_>) -> YtmTrack {
    let TrackFields {
        video_id,
        title,
        artists,
        album,
        duration_text,
        subtitle_for_kind,
        thumbnails,
        is_explicit,
        live_badge,
        video_type,
    } = fields;
    let artist_text = artists
        .iter()
        .map(|a| a.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let duration_sec = duration_text.as_deref().and_then(parse_duration_sec);
    let recording_kind = classify_recording_kind(&title, subtitle_for_kind, live_badge, video_type);
    let recording_label = recording_kind.label_vi().to_string();
    let uri = format!("ytmusic://{}", video_id);
    YtmTrack {
        video_id,
        title,
        artists,
        artist_text,
        album,
        duration_sec,
        duration_text,
        thumbnails,
        is_explicit,
        recording_kind,
        recording_label,
        source: "ytmusic".to_string(),
        uri,
    }
}

fn extract_responsive_runs(item: &Value, col_idx: usize) -> Vec<(String, Option<String>)> {
    let Some(runs) = item
        .get("flexColumns")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.get(col_idx))
        .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
        .and_then(|r| r.get("text"))
        .and_then(|t| t.get("runs"))
        .and_then(|r| r.as_array())
    else {
        return Vec::new();
    };
    runs.iter()
        .filter_map(|run| {
            let text = run.get("text").and_then(|t| t.as_str())?.to_string();
            let browse_id = run
                .get("navigationEndpoint")
                .and_then(|n| n.get("browseEndpoint"))
                .and_then(|b| b.get("browseId"))
                .and_then(|id| id.as_str())
                .map(|s| s.to_string());
            Some((text, browse_id))
        })
        .collect()
}

fn is_separator_token(s: &str) -> bool {
    matches!(s.trim(), "•" | "·" | "-" | "|" | "," | "&") || s.trim().is_empty()
}

fn is_duration_token(s: &str) -> bool {
    parse_duration_sec(s).is_some()
}

fn is_views_or_type_token(s: &str) -> bool {
    let lower = s.trim().to_ascii_lowercase();
    lower.ends_with("plays")
        || lower.ends_with("views")
        || lower.ends_with("listeners")
        || lower == "song"
        || lower == "video"
        || lower == "album"
        || lower == "single"
        || lower == "ep"
        || lower == "artist"
        || lower == "live"
}

fn split_artists_and_album(
    runs: &[(String, Option<String>)],
) -> (Vec<ArtistRef>, Option<AlbumRef>, Option<String>) {
    let mut artists = Vec::new();
    let mut album = None;
    let mut duration_text = None;

    for (text, browse_opt) in runs {
        let trimmed = text.trim();
        if is_separator_token(trimmed) {
            continue;
        }
        if is_duration_token(trimmed) {
            duration_text = Some(trimmed.to_string());
            continue;
        }
        if is_views_or_type_token(trimmed) {
            continue;
        }
        if let Some(bid) = browse_opt {
            if bid.starts_with("MPREb_") || bid.starts_with("OLAK5uy_") {
                if album.is_none() {
                    album = Some(AlbumRef {
                        id: Some(bid.clone()),
                        name: trimmed.to_string(),
                    });
                }
                continue;
            }
            if bid.starts_with("UC") {
                artists.push(ArtistRef {
                    id: Some(bid.clone()),
                    name: trimmed.to_string(),
                });
                continue;
            }
        }
        if artists.is_empty() {
            artists.push(ArtistRef {
                id: browse_opt.clone(),
                name: trimmed.to_string(),
            });
        }
    }

    (artists, album, duration_text)
}

fn parse_responsive_track(
    item: &Value,
    default_artists: &[ArtistRef],
    default_album: Option<&AlbumRef>,
    default_thumbs: &[String],
) -> Option<(YtmTrack, Option<String>)> {
    let col0_runs = extract_responsive_runs(item, 0);
    let title = col0_runs.first().map(|r| r.0.clone()).unwrap_or_default();
    if title.is_empty() {
        return None;
    }

    let overlay_nav = item
        .get("overlay")
        .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("musicPlayButtonRenderer"))
        .and_then(|b| b.get("playNavigationEndpoint"));

    let (overlay_vid, _, overlay_vtype) = extract_nav_id(overlay_nav);
    let (title_vid, _, title_vtype) = extract_nav_id(
        item.get("flexColumns")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
            .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
            .and_then(|r| r.get("text"))
            .and_then(|t| t.get("runs"))
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .and_then(|r| r.get("navigationEndpoint")),
    );
    let playlist_vid = item
        .get("playlistItemData")
        .and_then(|p| p.get("videoId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let video_id = playlist_vid.or(overlay_vid).or(title_vid)?;
    let video_type = overlay_vtype.or(title_vtype);

    let col1_runs = extract_responsive_runs(item, 1);
    let col2_runs = extract_responsive_runs(item, 2);
    let subtitle_joined = col1_runs
        .iter()
        .chain(col2_runs.iter())
        .map(|r| r.0.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    let (mut artists, mut album, mut duration_text) = split_artists_and_album(&col1_runs);
    if !col2_runs.is_empty() {
        let (a2, alb2, dur2) = split_artists_and_album(&col2_runs);
        if artists.is_empty() {
            artists = a2;
        }
        if album.is_none() {
            album = alb2;
        }
        if duration_text.is_none() {
            duration_text = dur2;
        }
    }

    if duration_text.is_none() {
        if let Some(fixed) = item
            .get("fixedColumns")
            .and_then(|f| f.as_array())
            .and_then(|a| a.first())
        {
            let txt = runs_text(
                fixed
                    .get("musicResponsiveListItemFixedColumnRenderer")
                    .and_then(|r| r.get("text")),
            );
            if is_duration_token(&txt) {
                duration_text = Some(txt.trim().to_string());
            }
        }
    }

    if artists.is_empty() && !default_artists.is_empty() {
        artists = default_artists.to_vec();
    }
    if album.is_none() {
        album = default_album.cloned();
    }

    let mut thumbnails = thumbnails_from(item.get("thumbnail"));
    if thumbnails.is_empty() && !default_thumbs.is_empty() {
        thumbnails = default_thumbs.to_vec();
    }

    let track = build_track(TrackFields {
        video_id,
        title,
        artists,
        album,
        duration_text,
        subtitle_for_kind: &subtitle_joined,
        thumbnails,
        is_explicit: has_explicit_badge(item),
        live_badge: has_live_badge(item),
        video_type: video_type.as_deref(),
    });

    Some((track, video_type))
}

fn parse_responsive_album(item: &Value) -> Option<YtmAlbumSummary> {
    let nav = item.get("navigationEndpoint");
    let (_, browse_opt, _) = extract_nav_id(nav);
    let browse_id =
        browse_opt.filter(|id| id.starts_with("MPREb_") || id.starts_with("OLAK5uy_"))?;
    let title = extract_responsive_runs(item, 0)
        .first()
        .map(|r| r.0.clone())
        .unwrap_or_default();
    if title.is_empty() {
        return None;
    }
    let runs = extract_responsive_runs(item, 1);
    let mut year = None;
    let mut artists = Vec::new();
    for (txt, bid) in runs {
        let t = txt.trim();
        if is_separator_token(t) || is_views_or_type_token(t) {
            continue;
        }
        if t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()) {
            year = Some(t.to_string());
        } else {
            artists.push(ArtistRef {
                id: bid,
                name: t.to_string(),
            });
        }
    }
    let playlist_id = item
        .get("overlay")
        .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("musicPlayButtonRenderer"))
        .and_then(|b| b.get("playNavigationEndpoint"))
        .and_then(|n| n.get("watchPlaylistEndpoint"))
        .and_then(|w| w.get("playlistId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(YtmAlbumSummary {
        browse_id,
        playlist_id,
        title,
        artists,
        year,
        thumbnails: thumbnails_from(item.get("thumbnail")),
        is_explicit: has_explicit_badge(item),
    })
}

fn parse_responsive_artist(item: &Value) -> Option<YtmArtistSummary> {
    let nav = item.get("navigationEndpoint");
    let (_, browse_opt, _) = extract_nav_id(nav);
    let browse_id = browse_opt.filter(|id| id.starts_with("UC"))?;
    let name = extract_responsive_runs(item, 0)
        .first()
        .map(|r| r.0.clone())
        .unwrap_or_default();
    if name.is_empty() {
        return None;
    }
    let runs = extract_responsive_runs(item, 1);
    let subscribers = runs.into_iter().map(|r| r.0).find(|t| {
        t.to_ascii_lowercase().contains("subscriber") || t.to_ascii_lowercase().contains("listener")
    });
    Some(YtmArtistSummary {
        browse_id,
        name,
        subscribers,
        thumbnails: thumbnails_from(item.get("thumbnail")),
    })
}

pub fn parse_search_response(query: &str, root: &Value) -> SearchResponse {
    let mut tracks = Vec::new();
    let mut videos = Vec::new();
    let mut albums = Vec::new();
    let mut artists = Vec::new();

    let mut seen_track_ids = HashSet::new();
    let mut seen_video_ids = HashSet::new();
    let mut seen_album_ids = HashSet::new();
    let mut seen_artist_ids = HashSet::new();

    let sections = root
        .get("contents")
        .and_then(|c| c.get("tabbedSearchResultsRenderer"))
        .and_then(|t| t.get("tabs"))
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|t| t.get("tabRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("sectionListRenderer"))
        .and_then(|s| s.get("contents"))
        .or_else(|| {
            root.get("contents")
                .and_then(|c| c.get("sectionListRenderer"))
                .and_then(|s| s.get("contents"))
        })
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();

    for section in sections {
        if let Some(card) = section.get("musicCardShelfRenderer") {
            let card_title = runs_text(card.get("title"));
            let card_sub = runs_text(card.get("subtitle"));
            let (vid_opt, bid_opt, vtype_opt) = extract_nav_id(card.get("onTap"));
            let thumbs = thumbnails_from(
                card.get("thumbnail")
                    .or_else(|| card.get("thumbnailRenderer")),
            );
            if let Some(vid) = vid_opt {
                if seen_track_ids.insert(vid.clone()) {
                    let sub_runs = card
                        .get("subtitle")
                        .and_then(|s| s.get("runs"))
                        .and_then(|r| r.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|r| {
                                    Some((
                                        r.get("text")?.as_str()?.to_string(),
                                        r.get("navigationEndpoint")
                                            .and_then(|n| n.get("browseEndpoint"))
                                            .and_then(|b| b.get("browseId"))
                                            .and_then(|i| i.as_str())
                                            .map(|s| s.to_string()),
                                    ))
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let (a, alb, dur) = split_artists_and_album(&sub_runs);
                    let tr = build_track(TrackFields {
                        video_id: vid,
                        title: card_title,
                        artists: a,
                        album: alb,
                        duration_text: dur,
                        subtitle_for_kind: &card_sub,
                        thumbnails: thumbs,
                        is_explicit: false,
                        live_badge: false,
                        video_type: vtype_opt.as_deref(),
                    });
                    tracks.push(tr);
                }
            } else if let Some(bid) = bid_opt {
                if bid.starts_with("UC") && seen_artist_ids.insert(bid.clone()) {
                    artists.push(YtmArtistSummary {
                        browse_id: bid,
                        name: card_title,
                        subscribers: Some(card_sub),
                        thumbnails: thumbs,
                    });
                } else if (bid.starts_with("MPREb_") || bid.starts_with("OLAK5uy_"))
                    && seen_album_ids.insert(bid.clone())
                {
                    albums.push(YtmAlbumSummary {
                        browse_id: bid,
                        playlist_id: None,
                        title: card_title,
                        artists: Vec::new(),
                        year: None,
                        thumbnails: thumbs,
                        is_explicit: false,
                    });
                }
            }

            if let Some(card_items) = card.get("contents").and_then(|c| c.as_array()) {
                for row in card_items {
                    if let Some(item) = row.get("musicResponsiveListItemRenderer") {
                        if let Some((tr, vtype)) = parse_responsive_track(item, &[], None, &[]) {
                            let is_vid = matches!(
                                vtype.as_deref(),
                                Some("MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_UGC")
                            );
                            if is_vid {
                                if seen_video_ids.insert(tr.video_id.clone()) {
                                    videos.push(tr);
                                }
                            } else if seen_track_ids.insert(tr.video_id.clone()) {
                                tracks.push(tr);
                            }
                        }
                    }
                }
            }
        }

        if let Some(shelf) = section.get("musicShelfRenderer") {
            let shelf_title = runs_text(shelf.get("title")).to_ascii_lowercase();
            let Some(rows) = shelf.get("contents").and_then(|c| c.as_array()) else {
                continue;
            };
            for row in rows {
                let Some(item) = row.get("musicResponsiveListItemRenderer") else {
                    continue;
                };
                if let Some((tr, vtype)) = parse_responsive_track(item, &[], None, &[]) {
                    let is_video_shelf = shelf_title.contains("video");
                    let is_vid = is_video_shelf
                        || matches!(
                            vtype.as_deref(),
                            Some("MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_UGC")
                        );
                    if is_vid && !shelf_title.contains("song") {
                        if seen_video_ids.insert(tr.video_id.clone()) {
                            videos.push(tr);
                        }
                    } else if seen_track_ids.insert(tr.video_id.clone()) {
                        tracks.push(tr);
                    }
                    continue;
                }
                if let Some(alb) = parse_responsive_album(item) {
                    if seen_album_ids.insert(alb.browse_id.clone()) {
                        albums.push(alb);
                    }
                    continue;
                }
                if let Some(art) = parse_responsive_artist(item) {
                    if seen_artist_ids.insert(art.browse_id.clone()) {
                        artists.push(art);
                    }
                }
            }
        }
    }

    SearchResponse {
        query: query.to_string(),
        tracks,
        videos,
        albums,
        artists,
    }
}

pub fn parse_album_detail(browse_id: &str, root: &Value) -> Result<AlbumDetail, YtmError> {
    let two_col = root
        .get("contents")
        .and_then(|c| c.get("twoColumnBrowseResultsRenderer"));
    let header_node = two_col
        .and_then(|tc| tc.get("tabs"))
        .and_then(|t| t.as_array())
        .and_then(|a| a.first())
        .and_then(|t| t.get("tabRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("sectionListRenderer"))
        .and_then(|s| s.get("contents"))
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|f| {
            f.get("musicResponsiveHeaderRenderer").or_else(|| {
                f.get("musicEditablePlaylistDetailHeaderRenderer")
                    .and_then(|e| e.get("header"))
                    .and_then(|h| h.get("musicResponsiveHeaderRenderer"))
            })
        })
        .or_else(|| {
            root.get("header")
                .and_then(|h| h.get("musicDetailHeaderRenderer"))
        })
        .ok_or_else(|| YtmError::NotFound(format!("Album header not found for {}", browse_id)))?;

    let title = runs_text(header_node.get("title"));
    let thumbnails = thumbnails_from(header_node.get("thumbnail"));
    let mut artists = Vec::new();
    if let Some(runs) = header_node
        .get("straplineTextOne")
        .or_else(|| header_node.get("subtitle"))
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
    {
        for r in runs {
            let txt = r.get("text").and_then(|x| x.as_str()).unwrap_or("").trim();
            if is_separator_token(txt) || is_views_or_type_token(txt) {
                continue;
            }
            let bid = r
                .get("navigationEndpoint")
                .and_then(|n| n.get("browseEndpoint"))
                .and_then(|b| b.get("browseId"))
                .and_then(|id| id.as_str())
                .map(|s| s.to_string());
            if bid.as_deref().is_some_and(|id| id.starts_with("UC"))
                || header_node.get("straplineTextOne").is_some()
            {
                artists.push(ArtistRef {
                    id: bid,
                    name: txt.to_string(),
                });
            }
        }
    }

    let subtitle_text = runs_text(header_node.get("subtitle"));
    let year = subtitle_text
        .split('•')
        .map(|s| s.trim())
        .find(|s| s.len() == 4 && s.chars().all(|c| c.is_ascii_digit()))
        .map(|s| s.to_string());

    let description = header_node
        .get("description")
        .and_then(|d| {
            d.get("musicDescriptionShelfRenderer")
                .map(|r| runs_text(r.get("description")))
                .or_else(|| Some(runs_text(Some(d))))
        })
        .filter(|s| !s.is_empty());

    let second_sub = runs_text(header_node.get("secondSubtitle"));
    let duration_text = if second_sub.is_empty() {
        None
    } else {
        Some(second_sub)
    };

    let playlist_id = header_node
        .get("buttons")
        .and_then(|b| b.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|btn| {
                let nav = btn
                    .get("musicPlayButtonRenderer")
                    .and_then(|p| p.get("playNavigationEndpoint"));
                nav.and_then(|n| {
                    n.get("watchEndpoint")
                        .and_then(|w| w.get("playlistId"))
                        .or_else(|| {
                            n.get("watchPlaylistEndpoint")
                                .and_then(|w| w.get("playlistId"))
                        })
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
            })
        });

    let track_rows = two_col
        .and_then(|tc| tc.get("secondaryContents"))
        .and_then(|s| s.get("sectionListRenderer"))
        .and_then(|s| s.get("contents"))
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|s| {
                s.get("musicShelfRenderer")
                    .or_else(|| s.get("musicPlaylistShelfRenderer"))
                    .and_then(|m| m.get("contents"))
            })
        })
        .or_else(|| {
            root.get("contents")
                .and_then(|c| c.get("singleColumnBrowseResultsRenderer"))
                .and_then(|s| s.get("tabs"))
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|t| t.get("tabRenderer"))
                .and_then(|r| r.get("content"))
                .and_then(|c| c.get("sectionListRenderer"))
                .and_then(|s| s.get("contents"))
                .and_then(|a| a.as_array())
                .and_then(|arr| {
                    arr.iter().find_map(|s| {
                        s.get("musicShelfRenderer")
                            .or_else(|| s.get("musicPlaylistShelfRenderer"))
                            .and_then(|m| m.get("contents"))
                    })
                })
        })
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();

    let album_ref = AlbumRef {
        id: Some(browse_id.to_string()),
        name: title.clone(),
    };
    let mut tracks = Vec::new();
    for row in track_rows {
        if let Some(item) = row.get("musicResponsiveListItemRenderer") {
            if let Some((tr, _)) =
                parse_responsive_track(item, &artists, Some(&album_ref), &thumbnails)
            {
                tracks.push(tr);
            }
        }
    }

    Ok(AlbumDetail {
        browse_id: browse_id.to_string(),
        playlist_id,
        title,
        artists,
        year,
        description,
        track_count: tracks.len(),
        duration_text,
        thumbnails,
        tracks,
    })
}

fn parse_two_row_album(item: &Value) -> Option<YtmAlbumSummary> {
    let nav = item.get("navigationEndpoint");
    let (_, bid_opt, _) = extract_nav_id(nav);
    let browse_id = bid_opt?;
    if !browse_id.starts_with("MPREb_") && !browse_id.starts_with("OLAK5uy_") {
        return None;
    }
    let title = runs_text(item.get("title"));
    if title.is_empty() {
        return None;
    }
    let sub = runs_text(item.get("subtitle"));
    let year = sub
        .split('•')
        .map(|s| s.trim())
        .find(|s| s.len() == 4 && s.chars().all(|c| c.is_ascii_digit()))
        .map(|s| s.to_string());
    let playlist_id = item
        .get("thumbnailOverlay")
        .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("musicPlayButtonRenderer"))
        .and_then(|b| b.get("playNavigationEndpoint"))
        .and_then(|n| n.get("watchPlaylistEndpoint"))
        .and_then(|w| w.get("playlistId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some(YtmAlbumSummary {
        browse_id,
        playlist_id,
        title,
        artists: Vec::new(),
        year,
        thumbnails: thumbnails_from(item.get("thumbnailRenderer")),
        is_explicit: false,
    })
}

fn parse_two_row_track(item: &Value, default_artist: &ArtistRef) -> Option<YtmTrack> {
    let nav = item.get("navigationEndpoint");
    let (vid_opt, _, vtype_opt) = extract_nav_id(nav);
    let video_id = vid_opt?;
    let title = runs_text(item.get("title"));
    if title.is_empty() {
        return None;
    }
    let sub = runs_text(item.get("subtitle"));
    let mut artists = Vec::new();
    if let Some(runs) = item
        .get("subtitle")
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
    {
        for r in runs {
            let txt = r.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
            if is_separator_token(txt) || is_views_or_type_token(txt) || is_duration_token(txt) {
                continue;
            }
            let bid = r
                .get("navigationEndpoint")
                .and_then(|n| n.get("browseEndpoint"))
                .and_then(|b| b.get("browseId"))
                .and_then(|i| i.as_str())
                .map(|s| s.to_string());
            if bid.as_deref().is_some_and(|id| id.starts_with("UC")) {
                artists.push(ArtistRef {
                    id: bid,
                    name: txt.to_string(),
                });
            }
        }
    }
    if artists.is_empty() {
        artists.push(default_artist.clone());
    }
    Some(build_track(TrackFields {
        video_id,
        title,
        artists,
        album: None,
        duration_text: None,
        subtitle_for_kind: &sub,
        thumbnails: thumbnails_from(item.get("thumbnailRenderer")),
        is_explicit: false,
        live_badge: false,
        video_type: vtype_opt.as_deref(),
    }))
}

pub fn parse_artist_detail(browse_id: &str, root: &Value) -> Result<ArtistDetail, YtmError> {
    let header = root
        .get("header")
        .and_then(|h| {
            h.get("musicImmersiveHeaderRenderer")
                .or_else(|| h.get("musicVisualHeaderRenderer"))
        })
        .ok_or_else(|| YtmError::NotFound(format!("Artist header not found for {}", browse_id)))?;

    let name = runs_text(header.get("title"));
    let description = header
        .get("description")
        .map(|d| runs_text(Some(d)))
        .filter(|s| !s.is_empty());
    let subscribers = header
        .get("subscriptionButton")
        .and_then(|b| b.get("subscribeButtonRenderer"))
        .and_then(|r| r.get("subscriberCountText"))
        .map(|t| runs_text(Some(t)))
        .filter(|s| !s.is_empty());
    let views = header
        .get("monthlyListenerCount")
        .map(|m| runs_text(Some(m)))
        .filter(|s| !s.is_empty());
    let thumbnails = thumbnails_from(header.get("thumbnail"));
    let artist_ref = ArtistRef {
        id: Some(browse_id.to_string()),
        name: name.clone(),
    };

    let sections = root
        .get("contents")
        .and_then(|c| c.get("singleColumnBrowseResultsRenderer"))
        .and_then(|s| s.get("tabs"))
        .and_then(|a| a.as_array())
        .and_then(|a| a.first())
        .and_then(|t| t.get("tabRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("sectionListRenderer"))
        .and_then(|s| s.get("contents"))
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();

    let mut top_songs = Vec::new();
    let mut albums = Vec::new();
    let mut singles = Vec::new();
    let mut videos = Vec::new();
    let mut live_performances = Vec::new();
    let mut extra_desc = None;

    for sec in sections {
        if let Some(shelf) = sec.get("musicShelfRenderer") {
            if let Some(rows) = shelf.get("contents").and_then(|c| c.as_array()) {
                for row in rows {
                    if let Some(item) = row.get("musicResponsiveListItemRenderer") {
                        if let Some((tr, _)) = parse_responsive_track(
                            item,
                            std::slice::from_ref(&artist_ref),
                            None,
                            &[],
                        ) {
                            top_songs.push(tr);
                        }
                    }
                }
            }
        }
        if let Some(carousel) = sec.get("musicCarouselShelfRenderer") {
            let shelf_title = runs_text(
                carousel
                    .get("header")
                    .and_then(|h| h.get("musicCarouselShelfBasicHeaderRenderer"))
                    .and_then(|r| r.get("title")),
            )
            .to_ascii_lowercase();
            let Some(rows) = carousel.get("contents").and_then(|c| c.as_array()) else {
                continue;
            };
            for row in rows {
                if let Some(two_row) = row.get("musicTwoRowItemRenderer") {
                    if shelf_title.contains("single") || shelf_title.contains("ep") {
                        if let Some(alb) = parse_two_row_album(two_row) {
                            singles.push(alb);
                        }
                    } else if shelf_title.contains("album") {
                        if let Some(alb) = parse_two_row_album(two_row) {
                            albums.push(alb);
                        }
                    } else if shelf_title.contains("live") {
                        if let Some(mut tr) = parse_two_row_track(two_row, &artist_ref) {
                            tr.recording_kind = RecordingKind::Live;
                            tr.recording_label = RecordingKind::Live.label_vi().to_string();
                            live_performances.push(tr);
                        }
                    } else if shelf_title.contains("video") {
                        if let Some(tr) = parse_two_row_track(two_row, &artist_ref) {
                            videos.push(tr);
                        }
                    }
                }
            }
        }
        if extra_desc.is_none() {
            if let Some(desc_shelf) = sec.get("musicDescriptionShelfRenderer") {
                let d = runs_text(desc_shelf.get("description"));
                if !d.is_empty() {
                    extra_desc = Some(d);
                }
            }
        }
    }

    Ok(ArtistDetail {
        browse_id: browse_id.to_string(),
        name,
        description: description.or(extra_desc),
        subscribers,
        views,
        thumbnails,
        top_songs,
        albums,
        singles,
        videos,
        live_performances,
    })
}

pub fn clean_track_title(raw: &str) -> String {
    static SUFFIX_RE: OnceLock<Regex> = OnceLock::new();
    let re = SUFFIX_RE.get_or_init(|| {
        Regex::new(r"(?i)\s*[\(\[](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|lyrics?|hd|4k|remastered(?:\s*\d+)?|audio)[\)\]]")
            .expect("suffix re")
    });
    re.replace_all(raw, "").trim().to_string()
}

pub fn parse_lrc_lines(
    synced_lrc: Option<&str>,
    rich_sync: Option<&str>,
) -> (Vec<LyricLine>, bool) {
    let source = rich_sync
        .filter(|s| !s.trim().is_empty())
        .or(synced_lrc.filter(|s| !s.trim().is_empty()));
    let Some(raw) = source else {
        return (Vec::new(), false);
    };

    static LINE_TS_RE: OnceLock<Regex> = OnceLock::new();
    static WORD_TS_RE: OnceLock<Regex> = OnceLock::new();
    let line_re = LINE_TS_RE
        .get_or_init(|| Regex::new(r"\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]").expect("line ts re"));
    let word_re = WORD_TS_RE.get_or_init(|| {
        Regex::new(r"<(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?>([^<\r\n]*)").expect("word ts re")
    });

    let mut parsed: Vec<LyricLine> = Vec::new();
    let mut has_word_sync = false;

    for raw_line in raw.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut timestamps = Vec::new();
        for cap in line_re.captures_iter(trimmed) {
            if let Some(ms) = captures_to_ms(&cap[1], &cap[2], cap.get(3).map(|m| m.as_str())) {
                timestamps.push(ms);
            }
        }
        if timestamps.is_empty() {
            continue;
        }

        let body = line_re.replace_all(trimmed, "").trim().to_string();
        let mut words = Vec::new();
        let clean_text = if word_re.is_match(&body) {
            has_word_sync = true;
            let mut joined = String::new();
            for cap in word_re.captures_iter(&body) {
                if let Some(w_ms) = captures_to_ms(&cap[1], &cap[2], cap.get(3).map(|m| m.as_str()))
                {
                    let word_text = cap[4].to_string();
                    joined.push_str(&word_text);
                    words.push(LyricWord {
                        start_ms: w_ms,
                        end_ms: w_ms + 300,
                        text: word_text,
                    });
                }
            }
            for idx in 0..words.len().saturating_sub(1) {
                let next_start = words[idx + 1].start_ms;
                words[idx].end_ms = next_start.max(words[idx].start_ms);
            }
            joined.trim().to_string()
        } else {
            body
        };

        for ts in timestamps {
            parsed.push(LyricLine {
                start_ms: ts,
                end_ms: ts + 4000,
                text: clean_text.clone(),
                words: words.clone(),
            });
        }
    }

    parsed.sort_by_key(|l| l.start_ms);
    for idx in 0..parsed.len().saturating_sub(1) {
        let next_start = parsed[idx + 1].start_ms;
        parsed[idx].end_ms = next_start.max(parsed[idx].start_ms);
    }

    (parsed, has_word_sync)
}

fn captures_to_ms(min_s: &str, sec_s: &str, frac_s: Option<&str>) -> Option<u64> {
    let mins = min_s.parse::<u64>().ok()?;
    let secs = sec_s.parse::<u64>().ok()?;
    let frac_ms = match frac_s {
        Some(f) if f.len() == 1 => f.parse::<u64>().ok()? * 100,
        Some(f) if f.len() == 2 => f.parse::<u64>().ok()? * 10,
        Some(f) if f.len() >= 3 => f[..3].parse::<u64>().ok()?,
        _ => 0,
    };
    Some(mins * 60_000 + secs * 1000 + frac_ms)
}

fn is_predominantly_latin(s: &str) -> bool {
    let mut alpha = 0usize;
    let mut latin = 0usize;
    for ch in s.chars() {
        if ch.is_alphabetic() {
            alpha += 1;
            if ch.is_ascii_alphabetic() {
                latin += 1;
            }
        }
    }
    alpha > 0 && latin * 2 >= alpha
}

fn script_compatible(title: Option<&str>, lyrics: &str) -> bool {
    let Some(t) = title else {
        return true;
    };
    if !is_predominantly_latin(t) {
        return true;
    }
    let mut alpha = 0usize;
    let mut latin = 0usize;
    for ch in lyrics.chars() {
        if ch.is_alphabetic() {
            alpha += 1;
            if ch.is_ascii_alphabetic() {
                latin += 1;
            }
        }
    }
    alpha == 0 || latin * 5 >= alpha
}

pub async fn fetch_lyrics(
    client: &InnerTubeClient,
    video_id: &str,
    title_opt: Option<&str>,
    artist_opt: Option<&str>,
    duration_opt: Option<u64>,
) -> Result<LyricsResult, YtmError> {
    let mut resolved_title = title_opt.map(clean_track_title).filter(|s| !s.is_empty());
    let mut resolved_artist = artist_opt
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let mut resolved_dur = duration_opt;

    let mut fallback_simp: Option<LyricsResult> = None;

    if let Ok(resp) = client
        .http()
        .get(format!("https://api-lyrics.simpmusic.org/v1/{}", video_id))
        .header("User-Agent", SIMPMUSIC_LYRICS_UA)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<Value>().await {
                if let Some(items) = json.get("data").and_then(|d| d.as_array()) {
                    if let Some(res) = pick_best_simpmusic_lyrics(
                        video_id,
                        items,
                        resolved_title.as_deref(),
                        resolved_dur,
                    ) {
                        if res.has_time_sync
                            && script_compatible(resolved_title.as_deref(), &res.plain_lyrics)
                        {
                            return Ok(res);
                        }
                        fallback_simp = Some(res);
                    }
                }
            }
        }
    }

    if resolved_title.is_none() || resolved_artist.is_none() {
        if let Ok(player) = client
            .post_innertube(
                InnerTubeClientKind::VisionOs,
                "player",
                json!({ "videoId": video_id, "contentCheckOk": true, "racyCheckOk": true }),
            )
            .await
        {
            if resolved_title.is_none() {
                resolved_title = player
                    .get("videoDetails")
                    .and_then(|d| d.get("title"))
                    .and_then(|v| v.as_str())
                    .map(clean_track_title);
            }
            if resolved_artist.is_none() {
                resolved_artist = player
                    .get("videoDetails")
                    .and_then(|d| d.get("author"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().trim_end_matches(" - Topic").to_string());
            }
            if resolved_dur.is_none() {
                resolved_dur = player
                    .get("videoDetails")
                    .and_then(|d| d.get("lengthSeconds"))
                    .and_then(|v| {
                        v.as_str()
                            .and_then(|s| s.parse::<u64>().ok())
                            .or_else(|| v.as_u64())
                    });
            }
        }
    }

    if let Some(title) = resolved_title.as_deref() {
        let mut lrc_url = format!(
            "https://lrclib.net/api/search?track_name={}",
            urlencoding::encode(title)
        );
        if let Some(artist) = resolved_artist.as_deref() {
            lrc_url.push_str(&format!("&artist_name={}", urlencoding::encode(artist)));
        }
        if let Ok(resp) = client
            .http()
            .get(&lrc_url)
            .header("User-Agent", "VelunaMusic/1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(items) = resp.json::<Vec<Value>>().await {
                    if let Some(res) = pick_best_lrclib_lyrics(video_id, &items, resolved_dur) {
                        if res.has_time_sync {
                            return Ok(res);
                        }
                        if fallback_simp.is_none() {
                            fallback_simp = Some(res);
                        }
                    }
                }
            }
        }
    }

    if let Some(simp) = fallback_simp {
        return Ok(simp);
    }

    if let Ok(next_json) = client
        .post_innertube(
            InnerTubeClientKind::WebRemix,
            "next",
            json!({ "videoId": video_id }),
        )
        .await
    {
        if let Some(tabs) = next_json
            .get("contents")
            .and_then(|c| c.get("singleColumnMusicWatchNextResultsRenderer"))
            .and_then(|s| s.get("tabbedRenderer"))
            .and_then(|t| t.get("watchNextTabbedResultsRenderer"))
            .and_then(|w| w.get("tabs"))
            .and_then(|a| a.as_array())
        {
            let lyrics_browse_id = tabs.iter().find_map(|tab| {
                tab.get("tabRenderer")
                    .and_then(|r| r.get("endpoint"))
                    .and_then(|e| e.get("browseEndpoint"))
                    .and_then(|b| b.get("browseId"))
                    .and_then(|id| id.as_str())
                    .filter(|id| id.starts_with("MPLYt_"))
                    .map(|s| s.to_string())
            });

            if let Some(browse_id) = lyrics_browse_id {
                if let Ok(lyr_json) = client
                    .post_innertube(
                        InnerTubeClientKind::WebRemix,
                        "browse",
                        json!({ "browseId": browse_id }),
                    )
                    .await
                {
                    let plain = lyr_json
                        .get("contents")
                        .and_then(|c| c.get("sectionListRenderer"))
                        .and_then(|s| s.get("contents"))
                        .and_then(|a| a.as_array())
                        .and_then(|a| a.first())
                        .and_then(|f| f.get("musicDescriptionShelfRenderer"))
                        .map(|d| runs_text(d.get("description")))
                        .unwrap_or_default();

                    if !plain.trim().is_empty() {
                        return Ok(LyricsResult {
                            video_id: video_id.to_string(),
                            source_provider: "ytmusic".to_string(),
                            has_time_sync: false,
                            has_word_sync: false,
                            synced_lrc: None,
                            plain_lyrics: plain,
                            lines: Vec::new(),
                        });
                    }
                }
            }
        }
    }

    Err(YtmError::NotFound(format!(
        "Lyrics not found for {}",
        video_id
    )))
}

fn pick_best_simpmusic_lyrics(
    video_id: &str,
    items: &[Value],
    title: Option<&str>,
    target_dur: Option<u64>,
) -> Option<LyricsResult> {
    let mut best: Option<(i64, LyricsResult)> = None;
    for item in items {
        let synced = item
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        let rich = item
            .get("richSyncLyrics")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        let plain = item
            .get("plainLyric")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let (lines, has_word_sync) = parse_lrc_lines(synced.as_deref(), rich.as_deref());
        let has_time_sync = !lines.is_empty();
        if !has_time_sync && plain.trim().is_empty() {
            continue;
        }
        let vote = item.get("vote").and_then(|v| v.as_i64()).unwrap_or(0);
        let dur = item.get("durationSeconds").and_then(|v| v.as_u64());
        let mut score = vote * 10;
        if has_time_sync {
            score += 500;
        }
        if has_word_sync {
            score += 100;
        }
        let check_text = synced.as_deref().unwrap_or(&plain);
        if script_compatible(title, check_text) {
            score += 300;
        }
        if let (Some(td), Some(d)) = (target_dur, dur) {
            let diff = td.abs_diff(d);
            if diff <= 5 {
                score += 100;
            } else if diff > 25 {
                score -= 100;
            }
        }
        let plain_out = if plain.trim().is_empty() {
            lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            plain
        };
        let candidate = LyricsResult {
            video_id: video_id.to_string(),
            source_provider: "simpmusic".to_string(),
            has_time_sync,
            has_word_sync,
            synced_lrc: synced.or(rich),
            plain_lyrics: plain_out,
            lines,
        };
        if best.as_ref().is_none_or(|(b_score, _)| score > *b_score) {
            best = Some((score, candidate));
        }
    }
    best.map(|(_, r)| r)
}

fn pick_best_lrclib_lyrics(
    video_id: &str,
    items: &[Value],
    target_dur: Option<u64>,
) -> Option<LyricsResult> {
    let mut best: Option<(i64, LyricsResult)> = None;
    for item in items {
        let synced = item
            .get("syncedLyrics")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        let plain = item
            .get("plainLyrics")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let (lines, has_word_sync) = parse_lrc_lines(synced.as_deref(), None);
        let has_time_sync = !lines.is_empty();
        if !has_time_sync && plain.trim().is_empty() {
            continue;
        }
        let dur = item
            .get("duration")
            .and_then(|v| v.as_f64())
            .map(|d| d.round() as u64);
        let mut score = if has_time_sync { 500 } else { 100 };
        if let (Some(td), Some(d)) = (target_dur, dur) {
            let diff = td.abs_diff(d);
            if diff <= 5 {
                score += 200;
            } else if diff <= 15 {
                score += 80;
            } else if diff > 30 {
                score -= 200;
            }
        }
        let plain_out = if plain.trim().is_empty() {
            lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            plain
        };
        let candidate = LyricsResult {
            video_id: video_id.to_string(),
            source_provider: "lrclib".to_string(),
            has_time_sync,
            has_word_sync,
            synced_lrc: synced,
            plain_lyrics: plain_out,
            lines,
        };
        if best.as_ref().is_none_or(|(b_score, _)| score > *b_score) {
            best = Some((score, candidate));
        }
    }
    best.map(|(_, r)| r)
}

fn extract_browse_page_type(nav: Option<&Value>) -> Option<String> {
    nav?
        .get("browseEndpoint")?
        .get("browseEndpointContextSupportedConfigs")?
        .get("browseEndpointContextMusicConfig")?
        .get("pageType")?
        .as_str()
        .map(|s| s.to_string())
}

fn extract_watch_playlist_id(nav: Option<&Value>) -> Option<String> {
    let n = nav?;
    n.get("watchPlaylistEndpoint")
        .and_then(|w| w.get("playlistId"))
        .or_else(|| n.get("watchEndpoint").and_then(|w| w.get("playlistId")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn home_artist_from_subtitle(item: &Value, subtitle: &str) -> String {
    let mut parts = Vec::new();
    if let Some(runs) = item
        .get("subtitle")
        .and_then(|s| s.get("runs"))
        .and_then(|r| r.as_array())
    {
        for r in runs {
            let txt = r.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
            if is_separator_token(txt) || is_views_or_type_token(txt) || is_duration_token(txt) {
                continue;
            }
            let lower = txt.to_ascii_lowercase();
            if lower == "playlist" || lower == "chart" || lower.ends_with("songs") {
                continue;
            }
            if txt.len() == 4 && txt.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            parts.push(txt.to_string());
        }
    }
    if parts.is_empty() {
        subtitle.trim().to_string()
    } else {
        parts.join(", ")
    }
}

fn parse_home_chip_cloud(chip: &Value) -> Option<HomeMoodChip> {
    let label = runs_text(chip.get("text")).trim().to_string();
    if label.is_empty() {
        return None;
    }
    let browse = chip
        .get("navigationEndpoint")
        .and_then(|n| n.get("browseEndpoint"))?;
    let browse_id = browse
        .get("browseId")
        .and_then(|v| v.as_str())
        .unwrap_or("FEmusic_home")
        .to_string();
    let params = browse
        .get("params")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if params.is_empty() && browse_id == "FEmusic_home" {
        return None;
    }
    let selected = chip
        .get("isSelected")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Some(HomeMoodChip {
        label,
        params,
        browse_id,
        selected,
    })
}

fn parse_home_nav_button(btn: &Value) -> Option<HomeMoodChip> {
    let label = runs_text(btn.get("buttonText")).trim().to_string();
    if label.is_empty() {
        return None;
    }
    let browse = btn
        .get("clickCommand")
        .and_then(|c| c.get("browseEndpoint"))?;
    let browse_id = browse
        .get("browseId")
        .and_then(|v| v.as_str())
        .unwrap_or("FEmusic_home")
        .to_string();
    let params = browse
        .get("params")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if params.is_empty() && browse_id == "FEmusic_home" {
        return None;
    }
    Some(HomeMoodChip {
        label,
        params,
        browse_id,
        selected: false,
    })
}

fn parse_home_two_row_item(item: &Value, shelf_title_lower: &str) -> Option<HomeItem> {
    let title = runs_text(item.get("title")).trim().to_string();
    if title.is_empty() {
        return None;
    }
    let subtitle = runs_text(item.get("subtitle")).trim().to_string();
    let title_nav = item
        .get("title")
        .and_then(|t| t.get("runs"))
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .and_then(|r| r.get("navigationEndpoint"));
    let nav = item.get("navigationEndpoint").or(title_nav);
    let overlay_nav = item
        .get("thumbnailOverlay")
        .or_else(|| item.get("overlay"))
        .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("musicPlayButtonRenderer"))
        .and_then(|b| b.get("playNavigationEndpoint"));

    let (nav_vid, nav_bid, nav_vtype) = extract_nav_id(nav);
    let (ov_vid, _, ov_vtype) = extract_nav_id(overlay_nav);
    let page_type = extract_browse_page_type(nav);
    let playlist_id = extract_watch_playlist_id(nav).or_else(|| extract_watch_playlist_id(overlay_nav));
    let video_type = nav_vtype.or(ov_vtype);
    let thumbnail = best_thumbnail(item.get("thumbnailRenderer").or_else(|| item.get("thumbnail")));
    let artist = home_artist_from_subtitle(item, &subtitle);

    if let Some(vid) = nav_vid {
        let is_video = shelf_title_lower.contains("video")
            || matches!(
                video_type.as_deref(),
                Some("MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_UGC")
            );
        let kind = classify_recording_kind(&title, &subtitle, has_live_badge(item), video_type.as_deref());
        return Some(HomeItem {
            id: vid.clone(),
            title,
            subtitle,
            artist,
            thumbnail,
            item_type: if is_video {
                HomeItemKind::Video
            } else {
                HomeItemKind::Song
            },
            video_id: Some(vid),
            browse_id: nav_bid,
            playlist_id,
            recording_kind: Some(kind),
            recording_label: Some(kind.label_vi().to_string()),
        });
    }

    if let Some(bid) = nav_bid {
        let item_type = if page_type.as_deref() == Some("MUSIC_PAGE_TYPE_ALBUM")
            || bid.starts_with("MPREb_")
        {
            HomeItemKind::Album
        } else if page_type.as_deref() == Some("MUSIC_PAGE_TYPE_PLAYLIST")
            || bid.starts_with("VL")
            || bid.starts_with("RDCLAK")
            || bid.starts_with("OLAK5uy_")
            || bid.starts_with("PL")
            || playlist_id.is_some()
        {
            HomeItemKind::Playlist
        } else {
            return None;
        };
        return Some(HomeItem {
            id: bid.clone(),
            title,
            subtitle,
            artist,
            thumbnail,
            item_type,
            video_id: None,
            browse_id: Some(bid),
            playlist_id,
            recording_kind: None,
            recording_label: None,
        });
    }

    if let Some(pid) = playlist_id {
        let bid = if pid.starts_with("VL") {
            pid.clone()
        } else {
            format!("VL{pid}")
        };
        return Some(HomeItem {
            id: bid.clone(),
            title,
            subtitle,
            artist,
            thumbnail,
            item_type: HomeItemKind::Playlist,
            video_id: None,
            browse_id: Some(bid),
            playlist_id: Some(pid),
            recording_kind: None,
            recording_label: None,
        });
    }

    if let Some(vid) = ov_vid {
        let is_video = shelf_title_lower.contains("video")
            || matches!(
                video_type.as_deref(),
                Some("MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_UGC")
            );
        let kind = classify_recording_kind(&title, &subtitle, has_live_badge(item), video_type.as_deref());
        return Some(HomeItem {
            id: vid.clone(),
            title,
            subtitle,
            artist,
            thumbnail,
            item_type: if is_video {
                HomeItemKind::Video
            } else {
                HomeItemKind::Song
            },
            video_id: Some(vid),
            browse_id: None,
            playlist_id: None,
            recording_kind: Some(kind),
            recording_label: Some(kind.label_vi().to_string()),
        });
    }

    None
}

fn parse_home_responsive_item(item: &Value, shelf_title_lower: &str) -> Option<HomeItem> {
    if let Some((tr, vtype)) = parse_responsive_track(item, &[], None, &[]) {
        let is_video = shelf_title_lower.contains("video")
            || matches!(
                vtype.as_deref(),
                Some("MUSIC_VIDEO_TYPE_OMV" | "MUSIC_VIDEO_TYPE_UGC")
            );
        let mut sub_parts = Vec::new();
        if !tr.artist_text.is_empty() {
            sub_parts.push(tr.artist_text.clone());
        }
        if let Some(alb) = &tr.album {
            if !alb.name.is_empty() {
                sub_parts.push(alb.name.clone());
            }
        }
        if let Some(dur) = &tr.duration_text {
            sub_parts.push(dur.clone());
        }
        let thumbnail = best_thumbnail(item.get("thumbnail"));
        return Some(HomeItem {
            id: tr.video_id.clone(),
            title: tr.title,
            subtitle: sub_parts.join(" · "),
            artist: tr.artist_text,
            thumbnail,
            item_type: if is_video {
                HomeItemKind::Video
            } else {
                HomeItemKind::Song
            },
            video_id: Some(tr.video_id),
            browse_id: None,
            playlist_id: None,
            recording_kind: Some(tr.recording_kind),
            recording_label: Some(tr.recording_label),
        });
    }

    let nav = item.get("navigationEndpoint");
    let (_, bid_opt, _) = extract_nav_id(nav);
    let bid = bid_opt?;
    let page_type = extract_browse_page_type(nav);
    let item_type = if page_type.as_deref() == Some("MUSIC_PAGE_TYPE_ALBUM") || bid.starts_with("MPREb_") {
        HomeItemKind::Album
    } else if page_type.as_deref() == Some("MUSIC_PAGE_TYPE_PLAYLIST")
        || bid.starts_with("VL")
        || bid.starts_with("OLAK5uy_")
        || bid.starts_with("RDCLAK")
    {
        HomeItemKind::Playlist
    } else {
        return None;
    };
    let title = extract_responsive_runs(item, 0)
        .first()
        .map(|r| r.0.clone())
        .unwrap_or_default();
    if title.is_empty() {
        return None;
    }
    let subtitle = extract_responsive_runs(item, 1)
        .into_iter()
        .map(|r| r.0)
        .collect::<Vec<_>>()
        .join("");
    let artist = subtitle.trim().to_string();
    Some(HomeItem {
        id: bid.clone(),
        title,
        subtitle,
        artist,
        thumbnail: best_thumbnail(item.get("thumbnail")),
        item_type,
        video_id: None,
        browse_id: Some(bid),
        playlist_id: None,
        recording_kind: None,
        recording_label: None,
    })
}

pub fn parse_home_response(root: &Value) -> HomeResponse {
    let section_list = root
        .get("contents")
        .and_then(|c| c.get("singleColumnBrowseResultsRenderer"))
        .and_then(|s| s.get("tabs"))
        .and_then(|t| t.as_array())
        .and_then(|a| a.first())
        .and_then(|t| t.get("tabRenderer"))
        .and_then(|r| r.get("content"))
        .and_then(|c| c.get("sectionListRenderer"))
        .or_else(|| {
            root.get("continuationContents")
                .and_then(|c| c.get("sectionListContinuation"))
        })
        .or_else(|| {
            root.get("contents")
                .and_then(|c| c.get("sectionListRenderer"))
        });

    let mut chips = Vec::new();
    let mut seen_chips = HashSet::new();
    let mut shelves = Vec::new();

    if let Some(list) = section_list {
        if let Some(raw_chips) = list
            .get("header")
            .and_then(|h| h.get("chipCloudRenderer"))
            .and_then(|c| c.get("chips"))
            .and_then(|a| a.as_array())
        {
            for entry in raw_chips {
                if let Some(chip_node) = entry.get("chipCloudChipRenderer") {
                    if let Some(chip) = parse_home_chip_cloud(chip_node) {
                        if seen_chips.insert((chip.label.clone(), chip.params.clone())) {
                            chips.push(chip);
                        }
                    }
                }
            }
        }

        let sections = list
            .get("contents")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();

        for sec in sections {
            if let Some(btn) = sec.get("musicNavigationButtonRenderer") {
                if let Some(chip) = parse_home_nav_button(btn) {
                    if seen_chips.insert((chip.label.clone(), chip.params.clone())) {
                        chips.push(chip);
                    }
                }
                continue;
            }
            if let Some(grid) = sec.get("gridRenderer") {
                if let Some(grid_items) = grid.get("items").and_then(|a| a.as_array()) {
                    for entry in grid_items {
                        if let Some(btn) = entry.get("musicNavigationButtonRenderer") {
                            if let Some(chip) = parse_home_nav_button(btn) {
                                if seen_chips.insert((chip.label.clone(), chip.params.clone())) {
                                    chips.push(chip);
                                }
                            }
                        }
                    }
                }
                continue;
            }

            let shelf_node = sec
                .get("musicCarouselShelfRenderer")
                .or_else(|| sec.get("musicImmersiveCarouselShelfRenderer"))
                .or_else(|| sec.get("musicShelfRenderer"));
            let Some(shelf) = shelf_node else {
                continue;
            };

            let title = runs_text(
                shelf
                    .get("header")
                    .and_then(|h| {
                        h.get("musicCarouselShelfBasicHeaderRenderer")
                            .or_else(|| h.get("musicImmersiveCarouselShelfRenderer"))
                    })
                    .and_then(|r| r.get("title"))
                    .or_else(|| shelf.get("title")),
            )
            .trim()
            .to_string();
            let title_lower = title.to_ascii_lowercase();

            let Some(rows) = shelf.get("contents").and_then(|c| c.as_array()) else {
                continue;
            };

            let mut items = Vec::new();
            let mut seen_ids = HashSet::new();
            for row in rows {
                if let Some(btn) = row.get("musicNavigationButtonRenderer") {
                    if let Some(chip) = parse_home_nav_button(btn) {
                        if seen_chips.insert((chip.label.clone(), chip.params.clone())) {
                            chips.push(chip);
                        }
                    }
                    continue;
                }
                let parsed = if let Some(two_row) = row.get("musicTwoRowItemRenderer") {
                    parse_home_two_row_item(two_row, &title_lower)
                } else if let Some(resp) = row.get("musicResponsiveListItemRenderer") {
                    parse_home_responsive_item(resp, &title_lower)
                } else {
                    None
                };
                if let Some(item) = parsed {
                    if seen_ids.insert(item.id.clone()) {
                        items.push(item);
                    }
                }
            }

            if !items.is_empty() {
                shelves.push(HomeShelf {
                    title: if title.is_empty() {
                        "Đề xuất".to_string()
                    } else {
                        title
                    },
                    items,
                });
            }
        }
    }

    let continuation = section_list
        .and_then(|l| l.get("continuations"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("nextContinuationData"))
        .and_then(|d| d.get("continuation"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    HomeResponse {
        chips,
        shelves,
        continuation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_kind_distinguishes_variants() {
        assert_eq!(
            classify_recording_kind("Waiting For Love", "Avicii • Album", false, None),
            RecordingKind::Original
        );
        assert_eq!(
            classify_recording_kind("Hotel California (Live at The Forum)", "", false, None),
            RecordingKind::Live
        );
        assert_eq!(
            classify_recording_kind("See Tinh (Cukak Remix)", "", false, None),
            RecordingKind::Remix
        );
        assert_eq!(
            classify_recording_kind("Random Song", "", true, None),
            RecordingKind::Live
        );
        assert_eq!(
            classify_recording_kind("River Flows In You (Instrumental)", "", false, None),
            RecordingKind::Instrumental
        );
        assert_eq!(
            classify_recording_kind("My Heart Will Go On (Karaoke)", "", false, None),
            RecordingKind::Karaoke
        );
    }

    #[test]
    fn synced_lrc_line_and_word_parsing() {
        let lrc = "[00:01.33] Is this the real life?\n[00:07.27] Caught in a landslide\n";
        let (lines, word_sync) = parse_lrc_lines(Some(lrc), None);
        assert!(!word_sync);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].start_ms, 1330);
        assert_eq!(lines[0].end_ms, 7270);
        assert_eq!(lines[0].text, "Is this the real life?");

        let rich = "[00:01.00] <00:01.00>Hello <00:01.50>world\n";
        let (w_lines, has_w) = parse_lrc_lines(None, Some(rich));
        assert!(has_w);
        assert_eq!(w_lines[0].words.len(), 2);
        assert_eq!(w_lines[0].words[1].start_ms, 1500);
        assert_eq!(w_lines[0].words[1].text, "world");
    }

    #[test]
    fn home_feed_parses_mood_chips_and_carousels() {
        let fixture = json!({
            "contents": {
                "singleColumnBrowseResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "header": {
                                        "chipCloudRenderer": {
                                            "chips": [
                                                {
                                                    "chipCloudChipRenderer": {
                                                        "text": { "runs": [{ "text": "Energize" }] },
                                                        "isSelected": false,
                                                        "navigationEndpoint": {
                                                            "browseEndpoint": {
                                                                "browseId": "FEmusic_home",
                                                                "params": "ggM8Energize"
                                                            }
                                                        }
                                                    }
                                                },
                                                {
                                                    "chipCloudChipRenderer": {
                                                        "text": { "runs": [{ "text": "Relax" }] },
                                                        "isSelected": true,
                                                        "navigationEndpoint": {
                                                            "browseEndpoint": {
                                                                "browseId": "FEmusic_home",
                                                                "params": "ggM8Relax"
                                                            }
                                                        }
                                                    }
                                                }
                                            ]
                                        }
                                    },
                                    "contents": [
                                        {
                                            "musicCarouselShelfRenderer": {
                                                "header": {
                                                    "musicCarouselShelfBasicHeaderRenderer": {
                                                        "title": { "runs": [{ "text": "Quick picks" }] }
                                                    }
                                                },
                                                "contents": [
                                                    {
                                                        "musicResponsiveListItemRenderer": {
                                                            "playlistItemData": { "videoId": "xukbqwRuN5w" },
                                                            "thumbnail": {
                                                                "musicThumbnailRenderer": {
                                                                    "thumbnail": {
                                                                        "thumbnails": [
                                                                            { "url": "https://lh3.googleusercontent.com/demo=w120-h120-l90-rj", "width": 120, "height": 120 }
                                                                        ]
                                                                    }
                                                                }
                                                            },
                                                            "flexColumns": [
                                                                {
                                                                    "musicResponsiveListItemFlexColumnRenderer": {
                                                                        "text": { "runs": [{ "text": "Midnight Cobalt" }] }
                                                                    }
                                                                },
                                                                {
                                                                    "musicResponsiveListItemFlexColumnRenderer": {
                                                                        "text": {
                                                                            "runs": [
                                                                                {
                                                                                    "text": "Veluna Artist",
                                                                                    "navigationEndpoint": { "browseEndpoint": { "browseId": "UCartist001" } }
                                                                                },
                                                                                { "text": " • " },
                                                                                {
                                                                                    "text": "Cobalt Sessions",
                                                                                    "navigationEndpoint": { "browseEndpoint": { "browseId": "MPREb_album001" } }
                                                                                }
                                                                            ]
                                                                        }
                                                                    }
                                                                }
                                                            ]
                                                        }
                                                    }
                                                ]
                                            }
                                        },
                                        {
                                            "musicCarouselShelfRenderer": {
                                                "header": {
                                                    "musicCarouselShelfBasicHeaderRenderer": {
                                                        "title": { "runs": [{ "text": "Featured playlists" }] }
                                                    }
                                                },
                                                "contents": [
                                                    {
                                                        "musicTwoRowItemRenderer": {
                                                            "title": {
                                                                "runs": [{
                                                                    "text": "Trending 20 Vietnam",
                                                                    "navigationEndpoint": {
                                                                        "browseEndpoint": {
                                                                            "browseId": "VLOLAK5uy_trend20",
                                                                            "browseEndpointContextSupportedConfigs": {
                                                                                "browseEndpointContextMusicConfig": {
                                                                                    "pageType": "MUSIC_PAGE_TYPE_PLAYLIST"
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                }]
                                                            },
                                                            "subtitle": {
                                                                "runs": [
                                                                    { "text": "Chart" },
                                                                    { "text": " • " },
                                                                    { "text": "YouTube Charts" }
                                                                ]
                                                            },
                                                            "thumbnailRenderer": {
                                                                "musicThumbnailRenderer": {
                                                                    "thumbnail": {
                                                                        "thumbnails": [
                                                                            { "url": "https://lh3.googleusercontent.com/pl=w226-h226-l90-rj", "width": 226, "height": 226 },
                                                                            { "url": "https://lh3.googleusercontent.com/pl=w544-h544-l90-rj", "width": 544, "height": 544 }
                                                                        ]
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    },
                                                    {
                                                        "musicTwoRowItemRenderer": {
                                                            "title": { "runs": [{ "text": "After Hours" }] },
                                                            "subtitle": {
                                                                "runs": [
                                                                    { "text": "Album" },
                                                                    { "text": " • " },
                                                                    { "text": "The Weeknd" }
                                                                ]
                                                            },
                                                            "navigationEndpoint": {
                                                                "browseEndpoint": {
                                                                    "browseId": "MPREb_afterhours",
                                                                    "browseEndpointContextSupportedConfigs": {
                                                                        "browseEndpointContextMusicConfig": {
                                                                            "pageType": "MUSIC_PAGE_TYPE_ALBUM"
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                            "thumbnailRenderer": {
                                                                "musicThumbnailRenderer": {
                                                                    "thumbnail": {
                                                                        "thumbnails": [
                                                                            { "url": "https://lh3.googleusercontent.com/alb=w544-h544-l90-rj", "width": 544, "height": 544 }
                                                                        ]
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                ]
                                            }
                                        },
                                        {
                                            "musicImmersiveCarouselShelfRenderer": {
                                                "header": {
                                                    "musicCarouselShelfBasicHeaderRenderer": {
                                                        "title": { "runs": [{ "text": "Music videos" }] }
                                                    }
                                                },
                                                "contents": [
                                                    {
                                                        "musicTwoRowItemRenderer": {
                                                            "title": { "runs": [{ "text": "Neon Drift (Official Video)" }] },
                                                            "subtitle": {
                                                                "runs": [
                                                                    { "text": "Silo Band" },
                                                                    { "text": " • " },
                                                                    { "text": "2.1M views" }
                                                                ]
                                                            },
                                                            "navigationEndpoint": {
                                                                "watchEndpoint": {
                                                                    "videoId": "dQw4w9WgXcQ",
                                                                    "watchEndpointMusicSupportedConfigs": {
                                                                        "watchEndpointMusicConfig": {
                                                                            "musicVideoType": "MUSIC_VIDEO_TYPE_OMV"
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                            "thumbnailRenderer": {
                                                                "musicThumbnailRenderer": {
                                                                    "thumbnail": {
                                                                        "thumbnails": [
                                                                            { "url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg", "width": 640, "height": 480 }
                                                                        ]
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    },
                                                    {
                                                        "musicNavigationButtonRenderer": {
                                                            "buttonText": { "runs": [{ "text": "Chill" }] },
                                                            "clickCommand": {
                                                                "browseEndpoint": {
                                                                    "browseId": "FEmusic_moods_and_genres_category",
                                                                    "params": "ggMPOg1uX1JOQWZFeDByc2Jm"
                                                                }
                                                            }
                                                        }
                                                    }
                                                ]
                                            }
                                        }
                                    ],
                                    "continuations": [{
                                        "nextContinuationData": {
                                            "continuation": "4qmFsgNextPageToken"
                                        }
                                    }]
                                }
                            }
                        }
                    }]
                }
            }
        });

        let home = parse_home_response(&fixture);
        assert_eq!(home.chips.len(), 3);
        assert_eq!(home.chips[0].label, "Energize");
        assert_eq!(home.chips[0].params, "ggM8Energize");
        assert!(!home.chips[0].selected);
        assert_eq!(home.chips[1].label, "Relax");
        assert!(home.chips[1].selected);
        assert_eq!(home.chips[2].label, "Chill");
        assert_eq!(home.chips[2].browse_id, "FEmusic_moods_and_genres_category");

        assert_eq!(home.shelves.len(), 3);
        assert_eq!(home.shelves[0].title, "Quick picks");
        assert_eq!(home.shelves[0].items.len(), 1);
        let song = &home.shelves[0].items[0];
        assert_eq!(song.id, "xukbqwRuN5w");
        assert_eq!(song.item_type, HomeItemKind::Song);
        assert_eq!(song.artist, "Veluna Artist");
        assert_eq!(
            song.thumbnail,
            "https://lh3.googleusercontent.com/demo=w544-h544-l90-rj"
        );

        assert_eq!(home.shelves[1].title, "Featured playlists");
        assert_eq!(home.shelves[1].items.len(), 2);
        assert_eq!(home.shelves[1].items[0].id, "VLOLAK5uy_trend20");
        assert_eq!(home.shelves[1].items[0].item_type, HomeItemKind::Playlist);
        assert_eq!(home.shelves[1].items[0].artist, "YouTube Charts");
        assert_eq!(home.shelves[1].items[1].id, "MPREb_afterhours");
        assert_eq!(home.shelves[1].items[1].item_type, HomeItemKind::Album);
        assert_eq!(home.shelves[1].items[1].artist, "The Weeknd");

        assert_eq!(home.shelves[2].title, "Music videos");
        assert_eq!(home.shelves[2].items.len(), 1);
        assert_eq!(home.shelves[2].items[0].id, "dQw4w9WgXcQ");
        assert_eq!(home.shelves[2].items[0].item_type, HomeItemKind::Video);
        assert_eq!(home.shelves[2].items[0].artist, "Silo Band");
        assert_eq!(home.continuation.as_deref(), Some("4qmFsgNextPageToken"));
    }

    #[test]
    fn home_continuation_and_playlist_detail_parsing() {
        let cont_fixture = json!({
            "continuationContents": {
                "sectionListContinuation": {
                    "contents": [{
                        "musicCarouselShelfRenderer": {
                            "header": {
                                "musicCarouselShelfBasicHeaderRenderer": {
                                    "title": { "runs": [{ "text": "Song mixes" }] }
                                }
                            },
                            "contents": [{
                                "musicTwoRowItemRenderer": {
                                    "title": { "runs": [{ "text": "My Supermix" }] },
                                    "subtitle": { "runs": [{ "text": "Mixed for you" }] },
                                    "navigationEndpoint": {
                                        "watchPlaylistEndpoint": { "playlistId": "RDTMAK5uy_mix01" }
                                    },
                                    "thumbnailRenderer": {
                                        "musicThumbnailRenderer": {
                                            "thumbnail": {
                                                "thumbnails": [
                                                    { "url": "https://lh3.googleusercontent.com/mix=w544-h544-l90-rj", "width": 544, "height": 544 }
                                                ]
                                            }
                                        }
                                    }
                                }
                            }]
                        }
                    }]
                }
            }
        });
        let cont = parse_home_response(&cont_fixture);
        assert_eq!(cont.shelves.len(), 1);
        assert_eq!(cont.shelves[0].title, "Song mixes");
        assert_eq!(cont.shelves[0].items[0].item_type, HomeItemKind::Playlist);
        assert_eq!(cont.shelves[0].items[0].id, "VLRDTMAK5uy_mix01");

        let pl_fixture = json!({
            "contents": {
                "twoColumnBrowseResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [{
                                        "musicResponsiveHeaderRenderer": {
                                            "title": { "runs": [{ "text": "Trending 20 Vietnam" }] },
                                            "subtitle": { "runs": [{ "text": "Playlist • 2026" }] }
                                        }
                                    }]
                                }
                            }
                        }
                    }],
                    "secondaryContents": {
                        "sectionListRenderer": {
                            "contents": [{
                                "musicPlaylistShelfRenderer": {
                                    "contents": [{
                                        "musicResponsiveListItemRenderer": {
                                            "playlistItemData": { "videoId": "aB1_CD-2345" },
                                            "flexColumns": [
                                                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Track One" }] } } },
                                                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Artist One" }] } } }
                                            ]
                                        }
                                    }]
                                }
                            }]
                        }
                    }
                }
            }
        });
        let detail = parse_album_detail("VLOLAK5uy_trend20", &pl_fixture).expect("playlist detail");
        assert_eq!(detail.title, "Trending 20 Vietnam");
        assert_eq!(detail.tracks.len(), 1);
        assert_eq!(detail.tracks[0].video_id, "aB1_CD-2345");
    }
}
