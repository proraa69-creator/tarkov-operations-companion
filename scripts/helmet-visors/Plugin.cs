// RaidOsHelmets: pictures of helmets with their face shield lowered and raised (owner, 20.11.2026: «сделай скрины под каждый шлем с
// забралами… с забралом, которое подходит для них… опустить, поднять забрало»). A file go.flag in the plugin's folder starts a run (taken
// away when it starts); it waits while RaidOsGuns is busy. Each job of jobs.json is built the way the game builds an item (ItemFactory),
// the face shield put down (TogglableComponent.On = true) or up (false), and drawn by the game's own inventory icon renderer
// (ItemIconCreator: the icon's pose from the model's PreviewPivot, its lights and shadow). Only PNG files leave the game: out/*.png.
// Offline SPT copy on E: only; nothing of the live game is touched.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using BepInEx;
using Comfort.Common;
using EFT;
using EFT.InventoryLogic;
using JsonType;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RaidOsHelmets
{
    [BepInPlugin("app.raidos.helmets", "RaidOsHelmets", "0.1.0")]
    public class Plugin : BaseUnityPlugin
    {
        private bool _busy;
        private float _nextLook;
        private string Folder => Path.GetDirectoryName(Info.Location);
        private string GunsFolder => Path.Combine(Path.GetDirectoryName(Folder), "RaidOsGuns");

        private void Log(string text)
        {
            Logger.LogInfo(text);
            try { File.AppendAllText(Path.Combine(Folder, "helmets.log"), DateTime.Now.ToString("HH:mm:ss ") + text + "\n"); } catch { }
        }

        /// <summary>RaidOsGuns renders in the same game: wait until its log ends with «done» and nothing is queued for it.</summary>
        private bool GunsIdle()
        {
            try
            {
                if (!Directory.Exists(GunsFolder)) return true;
                if (File.Exists(Path.Combine(GunsFolder, "go.flag"))) return false;
                var log = Path.Combine(GunsFolder, "guns.log");
                if (!File.Exists(log)) return true;
                var last = File.ReadAllLines(log).Reverse().FirstOrDefault(line => line.Trim().Length > 0) ?? "";
                return last.EndsWith(" done") || last.Contains("run: ");
            }
            catch { return false; }
        }

        private void Awake() => Log("loaded " + Info.Metadata.Version);

        private void Update()
        {
            if (_busy || Time.unscaledTime < _nextLook) return;
            _nextLook = Time.unscaledTime + 1f;
            var file = Path.Combine(Folder, "go.flag");
            if (!File.Exists(file)) return;
            if (!GunsIdle()) { _nextLook = Time.unscaledTime + 5f; return; }
            try { File.Delete(file); } catch { }
            _ = RunAll();
        }

        private async Task RunAll()
        {
            _busy = true;
            try
            {
                var jobs = JArray.Parse(File.ReadAllText(Path.Combine(Folder, "jobs.json")));
                var factory = Singleton<ItemFactory>.Instance;
                var objects = FindObjectsFactory();
                Log($"start: {jobs.Count} jobs, ItemFactory {(factory != null)}, ObjectsFactory {(objects != null)}");
                if (factory == null || objects == null) return;
                var creator = await GetIconCreator(objects);
                Log($"icon creator: {(creator != null)}");
                if (creator == null) return;
                Directory.CreateDirectory(Path.Combine(Folder, "out"));
                foreach (JObject job in jobs)
                {
                    try { await RenderJob(job, factory, objects, creator); }
                    catch (Exception e) { Log($"{job["name"]}: {e}"); }
                }
                Log("done");
            }
            catch (Exception e) { Log("run: " + e); }
            finally { _busy = false; }
        }

        private ObjectsFactory FindObjectsFactory()
        {
            if (Singleton<ObjectsFactory>.Instantiated) return Singleton<ObjectsFactory>.Instance;
            var world = Singleton<GameWorld>.Instantiated ? Singleton<GameWorld>.Instance : null;
            return world == null ? null : typeof(GameWorld).GetField("ObjectsFactory", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)?.GetValue(world) as ObjectsFactory;
        }

        private async Task<ItemIconCreator> GetIconCreator(ObjectsFactory objects)
        {
            if (Singleton<ItemIconCreator>.Instantiated) return Singleton<ItemIconCreator>.Instance;
            try
            {
                var creator = new ItemIconCreator(objects.EasyAssets, objects);
                await creator.Init();
                return creator;
            }
            catch (Exception e) { Log("own icon creator: " + e.Message); return null; }
        }

        /// <summary>The job's helmet: a flat list of items like the game's presets (the helmet, its built-in plates, the face shield).</summary>
        private static Item BuildItem(JObject job, ItemFactory factory)
        {
            var rows = (JArray)job["items"];
            var flat = rows.Select(token => new FlatItem
            {
                _id = new MongoID((string)token["_id"]),
                _tpl = new MongoID((string)token["_tpl"]),
                parentId = token["parentId"] != null ? new MongoID((string)token["parentId"]) : (MongoID?)null,
                slotId = (string)token["slotId"],
            }).ToArray();
            var tree = factory.FlatItemsToTree(flat, true, null);
            var rootId = (string)rows[0]["_id"];
            return tree.Items.Values.First(item => item.Id == rootId);
        }

        private static IEnumerable<Item> AllParts(Item item)
        {
            yield return item;
            if (item is CompoundItem compound)
                foreach (var slot in compound.AllSlots)
                    if (slot.ContainedItem != null)
                        foreach (var inner in AllParts(slot.ContainedItem)) yield return inner;
        }

        private async Task RenderJob(JObject job, ItemFactory factory, ObjectsFactory objects, ItemIconCreator creator)
        {
            var name = (string)job["name"];
            var width = (int?)job["width"] ?? 512;
            var height = (int?)job["height"] ?? 512;
            var item = BuildItem(job, factory);
            var parts = AllParts(item).ToList();
            Log($"{name}: {item.Template?.Name} with {string.Join(", ", parts.Skip(1).Select(p => p.TemplateId.ToString()))}");
            var resources = parts.SelectMany(part => part.Template.AllResources).Distinct().ToArray();
            await objects.LoadBundlesAndCreatePools(ObjectsFactory.PoolsCategory.Raid, ObjectsFactory.AssemblyType.Local, resources,
                Diz.Jobs.JobYieldPriority.Immediate, null, CancellationToken.None);
            var shield = item.GetItemComponentsInChildren<FaceShieldComponent>(true).FirstOrDefault();
            Log($"{name}: face shield {(shield != null)}, togglable {(shield?.Togglable != null)}, on {shield?.Togglable?.On}");
            if (shield?.Togglable == null) return;
            foreach (var (state, on) in new[] { ("down", true), ("up", false) })
            {
                shield.Togglable.On = on;
                // A: the game's own inventory icon of the item as it is now (IconsHash counts the shield's position)
                try
                {
                    var sprite = await GameIcon(creator, item, new IntVec2(width, height));
                    if (sprite != null) { SavePng(sprite.texture, sprite.textureRect, Path.Combine(Folder, "out", $"{name}.{state}.icon.png")); Log($"{name} {state}: icon {sprite.textureRect.width}x{sprite.textureRect.height}"); }
                    else Log($"{name} {state}: icon renderer gave nothing");
                }
                catch (Exception e) { Log($"{name} {state}: icon: {e.Message}"); }
                // B: the model with its hinge turned the way HelmetDress turns it, drawn by the icon renderer from the model's PreviewPivot
                GameObject model = null;
                try
                {
                    model = objects.CreateItem(item, false);
                    model.transform.position = new Vector3(0, -900, 0);
                    model.SetActive(true);
                    var hinges = Hinge(model, item, on);
                    await Task.Yield();
                    Hinge(model, item, on);
                    var size = new IntVec2(width, height);
                    var pivot = model.GetComponent<PreviewPivot>() ?? model.GetComponentInChildren<PreviewPivot>(true);
                    var sprite = creator.CaptureSpriteOfModel(model, in size, pivot);
                    SavePng(sprite.texture, sprite.textureRect, Path.Combine(Folder, "out", $"{name}.{state}.capture.png"));
                    Log($"{name} {state}: capture {size.X}x{size.Y}, hinges {hinges}, pivot {(pivot != null)}");
                    // C: the same camera and pose drawn on black and on white, for a true alpha
                    var camera = creator.RenderCamera;
                    if (camera != null)
                    {
                        var rgba = GrabColor(camera, width, height);
                        File.WriteAllBytes(Path.Combine(Folder, "out", $"{name}.{state}.bw.png"), Png(rgba, width, height));
                        Log($"{name} {state}: black-white from the icon camera");
                    }
                }
                catch (Exception e) { Log($"{name} {state}: capture: {e.Message}"); }
                finally { if (model != null) UnityEngine.Object.Destroy(model); }
                await Task.Yield();
            }
            shield.Togglable.On = true;
        }

        /// <summary>The game's sprite of an item (IconCreatorBase.GetItemSpriteAsync: renders it, no icon cache is written).</summary>
        private static async Task<Sprite> GameIcon(ItemIconCreator creator, Item item, IntVec2 size)
        {
            var method = typeof(ItemIconCreator).BaseType.GetMethod("GetItemSpriteAsync", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (method == null) return null;
            var task = (Task)method.Invoke(creator, new object[] { item, size });
            await task;
            var result = task.GetType().GetProperty("Result")?.GetValue(task);
            if (result is Sprite sprite) return sprite;
            return result?.GetType().GetField("sprite")?.GetValue(result) as Sprite;
        }

        /// <summary>
        /// HelmetDress turns the shield's hinge (localRotation from OffRotation to OnRotation, EFT.Visual.HelmetDress): its own Init from the
        /// item, then the turn itself. The number of hinges found.
        /// </summary>
        private int Hinge(GameObject model, Item item, bool on)
        {
            var count = 0;
            foreach (var dress in model.GetComponentsInChildren<EFT.Visual.HelmetDress>(true))
            {
                try { dress.Init(item, false); } catch (Exception e) { Log($"HelmetDress.Init: {e.Message}"); }
                if (dress.HingeTransform == null) continue;
                dress.HingeTransform.localRotation = on ? dress.OnRotation : dress.OffRotation;
                count++;
            }
            return count;
        }

        private static void SavePng(Texture texture, Rect rect, string file)
        {
            var rt = RenderTexture.GetTemporary(texture.width, texture.height, 0, RenderTextureFormat.ARGB32);
            Graphics.Blit(texture, rt);
            var previous = RenderTexture.active;
            RenderTexture.active = rt;
            var copy = new Texture2D((int)rect.width, (int)rect.height, TextureFormat.RGBA32, false);
            copy.ReadPixels(rect, 0, 0);
            copy.Apply();
            RenderTexture.active = previous;
            RenderTexture.ReleaseTemporary(rt);
            File.WriteAllBytes(file, copy.EncodeToPNG());
            UnityEngine.Object.Destroy(copy);
        }

        private static byte[] Grab(Camera camera, int width, int height, Color background)
        {
            var rt = RenderTexture.GetTemporary(width, height, 24, RenderTextureFormat.ARGB32);
            var target = camera.targetTexture;
            var flags = camera.clearFlags;
            var color = camera.backgroundColor;
            camera.targetTexture = rt;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = background;
            camera.Render();
            var previous = RenderTexture.active;
            RenderTexture.active = rt;
            var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
            tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            tex.Apply();
            RenderTexture.active = previous;
            camera.targetTexture = target;
            camera.clearFlags = flags;
            camera.backgroundColor = color;
            RenderTexture.ReleaseTemporary(rt);
            var raw = tex.GetRawTextureData();
            UnityEngine.Object.Destroy(tex);
            return raw;
        }

        /// <summary>Drawn on black and on white: the difference is how much background shows through, the black drawing ÷ cover is the colour.</summary>
        private static byte[] GrabColor(Camera camera, int width, int height)
        {
            var dark = Grab(camera, width, height, new Color(0, 0, 0, 0));
            var light = Grab(camera, width, height, new Color(1, 1, 1, 0));
            var rgba = new byte[width * height * 4];
            for (var i = 0; i < width * height; i++)
            {
                var through = ((light[i * 4] - dark[i * 4]) + (light[i * 4 + 1] - dark[i * 4 + 1]) + (light[i * 4 + 2] - dark[i * 4 + 2])) / (3f * 255f);
                var alpha = Mathf.Clamp01(1f - through);
                rgba[i * 4 + 3] = (byte)Mathf.RoundToInt(alpha * 255f);
                if (alpha <= 0.004f) continue;
                for (var c = 0; c < 3; c++) rgba[i * 4 + c] = (byte)Mathf.Clamp(Mathf.RoundToInt(dark[i * 4 + c] / alpha), 0, 255);
            }
            return rgba;
        }

        private static byte[] Png(byte[] rgba, int width, int height)
        {
            var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
            tex.LoadRawTextureData(rgba);
            tex.Apply();
            var png = tex.EncodeToPNG();
            UnityEngine.Object.Destroy(tex);
            return png;
        }
    }
}
