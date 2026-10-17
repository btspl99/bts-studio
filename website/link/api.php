<?php
/**
 * BTS Link — signalling relay for BTS Studio remote guests.
 *
 * Lets a guest join from https://studio.btspl.tech/link/?r=ROOM&k=KEY without the studio forwarding a port.
 * Only the small WebRTC set-up messages (offer / answer / chat / tally) pass through here; audio and video go
 * directly between the guest's browser and BTS Studio. Nothing is kept: queues are deleted when read and rooms
 * that have not been seen for a day are removed.
 *
 *   POST ?a=host&r=ROOM   {secret, slots:{KEY:{title,needsPassword}}, ice:[...]}   studio registers / refreshes
 *   GET  ?a=info&r=ROOM&k=KEY                                                       guest: title, password?, ICE
 *   POST ?a=send&r=ROOM   {from:SID, msg}            guest → studio
 *   POST ?a=send&r=ROOM   {secret, to:SID, msg}      studio → guest
 *   GET  ?a=recv&r=ROOM&sid=SID                      guest: pending messages
 *   POST ?a=recv&r=ROOM   {secret}                   studio: pending messages (also a heartbeat)
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const DATA = __DIR__ . '/data';
const MAX_MSG = 65536, MAX_QUEUE = 120, HOST_TIMEOUT = 45, ROOM_TTL = 86400;

function out(array $a, int $code = 200): void { http_response_code($code); echo json_encode($a); exit; }
function fail(string $e, int $code = 400): void { out(['ok' => false, 'error' => $e], $code); }

$a = $_GET['a'] ?? '';
$raw = $_SERVER['REQUEST_METHOD'] === 'POST' ? (string)file_get_contents('php://input', false, null, 0, MAX_MSG + 4096) : '';
$body = $raw !== '' ? json_decode($raw, true) : [];
if (!is_array($body)) fail('Bad request');
$room = (string)($_GET['r'] ?? '');
if (!preg_match('/^[A-Za-z0-9]{16,40}$/', $room)) fail('Unknown link');
$dir = DATA . '/' . $room;
$meta = $dir . '/host.json';

function host(): ?array { global $meta; if (!is_file($meta)) return null; $m = json_decode((string)file_get_contents($meta), true); return is_array($m) ? $m : null; }
function authed(?array $m, $secret): bool { return $m && is_string($secret) && strlen($secret) >= 24 && hash_equals($m['h'], hash('sha256', $secret)); }
function qfile(string $who): string { global $dir; return $dir . '/q-' . $who . '.json'; }
function push(string $who, array $msg): bool {
  $f = fopen(qfile($who), 'c+'); if (!$f) return false;
  flock($f, LOCK_EX);
  $q = json_decode((string)stream_get_contents($f), true) ?: [];
  if (count($q) >= MAX_QUEUE) array_shift($q);
  $q[] = $msg;
  ftruncate($f, 0); rewind($f); fwrite($f, json_encode($q));
  flock($f, LOCK_UN); fclose($f);
  return true;
}
function take(string $who): array {
  $p = qfile($who); if (!is_file($p)) return [];
  $f = fopen($p, 'c+'); if (!$f) return [];
  flock($f, LOCK_EX);
  $q = json_decode((string)stream_get_contents($f), true) ?: [];
  ftruncate($f, 0);
  flock($f, LOCK_UN); fclose($f);
  @unlink($p);
  return $q;
}
function sid_ok($s): bool { return is_string($s) && preg_match('/^[A-Za-z0-9-]{8,64}$/', $s) === 1; }
function cleanup(): void { // occasionally drop rooms nobody has used for a day
  if (random_int(1, 40) !== 1) return;
  foreach (glob(DATA . '/*', GLOB_ONLYDIR) ?: [] as $d) {
    $h = $d . '/host.json';
    if (!is_file($h) || filemtime($h) < time() - ROOM_TTL) { foreach (glob($d . '/*') ?: [] as $f) @unlink($f); @rmdir($d); }
    else foreach (glob($d . '/q-*.json') ?: [] as $f) if (filemtime($f) < time() - 3600) @unlink($f);
  }
}

switch ($a) {
  case 'host': {
    $m = host();
    if ($m && !authed($m, $body['secret'] ?? null)) fail('This link belongs to another studio', 403);
    if (!$m && (!is_string($body['secret'] ?? null) || strlen($body['secret']) < 24)) fail('Bad secret');
    if (!is_dir($dir) && !mkdir($dir, 0700, true)) fail('Server storage error', 500);
    $slots = [];
    foreach ((array)($body['slots'] ?? []) as $k => $s) {
      if (!preg_match('/^[A-Z0-9]{4,12}$/', (string)$k) || count($slots) >= 32) continue;
      $slots[$k] = ['title' => mb_substr((string)($s['title'] ?? 'BTS Studio'), 0, 80), 'needsPassword' => !empty($s['needsPassword'])];
    }
    $ice = array_slice(array_values(array_filter((array)($body['ice'] ?? []), 'is_array')), 0, 6);
    file_put_contents($meta, json_encode(['h' => $m['h'] ?? hash('sha256', $body['secret']), 'slots' => $slots, 'ice' => $ice, 't' => time()]), LOCK_EX);
    cleanup();
    out(['ok' => true]);
  }
  case 'info': {
    $m = host(); $k = (string)($_GET['k'] ?? '');
    if (!$m || !isset($m['slots'][$k])) fail('This guest link is not active. Ask the producer for a new link.', 404);
    if ($m['t'] < time() - HOST_TIMEOUT) fail('The studio is offline. Ask the producer to open BTS Studio.', 503);
    $s = $m['slots'][$k];
    out(['ok' => true, 'title' => $s['title'], 'needsPassword' => $s['needsPassword'], 'iceServers' => $m['ice'], 'show' => $s['title']]);
  }
  case 'send': {
    $m = host(); if (!$m) fail('Unknown link', 404);
    $msg = $body['msg'] ?? null;
    if (!is_array($msg) || strlen($raw) > MAX_MSG) fail('Message too large');
    if (isset($body['secret'])) { // studio → guest
      if (!authed($m, $body['secret'])) fail('Not allowed', 403);
      if (!sid_ok($body['to'] ?? null)) fail('Bad recipient');
      push('g-' . $body['to'], $msg);
      out(['ok' => true]);
    }
    if (!sid_ok($body['from'] ?? null)) fail('Bad sender');
    if ($m['t'] < time() - HOST_TIMEOUT) fail('The studio is offline.', 503);
    $type = (string)($msg['type'] ?? '');
    if (!in_array($type, ['offer', 'bye', 'chat', 'state'], true)) fail('Bad message');
    $msg['sid'] = $body['from'];
    $msg['ip'] = $_SERVER['REMOTE_ADDR'] ?? '';
    push('host', $msg);
    out(['ok' => true]);
  }
  case 'recv': {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') { // studio
      $m = host(); if (!authed($m, $body['secret'] ?? null)) fail('Not allowed', 403);
      $m['t'] = time(); file_put_contents($meta, json_encode($m), LOCK_EX);
      out(['ok' => true, 'msgs' => take('host')]);
    }
    $sid = $_GET['sid'] ?? '';
    if (!sid_ok($sid) || !is_dir($dir)) fail('Bad request');
    out(['ok' => true, 'msgs' => take('g-' . $sid)]);
  }
  default: fail('Unknown action');
}
