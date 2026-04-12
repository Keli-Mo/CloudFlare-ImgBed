import { getDatabase } from '../../utils/databaseAdapter.js';

// CORS 跨域响应头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

/**
 * 检查文件是否存在的 API
 * 同时检查数据库记录和 R2/S3 存储中的实际文件
 * 支持 CORS，可以被外部站点调用
 */
export async function onRequest(context) {
    const {
        request,
        params,
        env,
    } = context;

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: corsHeaders
        });
    }

    // 只接受 GET 和 HEAD 请求
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });
    }

    // 解码文件ID
    let fileId = '';
    try {
        const decodedPath = decodeURIComponent(params.path);
        fileId = decodedPath.split(',').join('/');
    } catch (e) {
        return new Response(JSON.stringify({ exists: false, error: 'Invalid path' }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });
    }

    try {
        // 1. 从数据库中检查文件记录是否存在
        const db = getDatabase(env);
        const imgRecord = await db.getWithMetadata(fileId);

        // 数据库中无记录
        if (!imgRecord) {
            return new Response(JSON.stringify({ exists: false }), {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        // 2. 根据存储渠道检查实际文件是否存在
        const channel = imgRecord.metadata?.Channel;
        const fileExists = await checkFileExists(env, fileId, channel);

        if (!fileExists) {
            return new Response(JSON.stringify({ exists: false, error: 'File not found in storage' }), {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        // 文件存在，返回基本信息
        const response = {
            exists: true,
            fileName: imgRecord.metadata?.FileName || fileId,
            fileType: imgRecord.metadata?.FileType || null,
            channel: channel || null,
            timestamp: imgRecord.metadata?.TimeStamp || null,
        };

        // HEAD 请求只返回状态码，不返回 body
        if (request.method === 'HEAD') {
            return new Response(null, {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "X-File-Exists": "true",
                    "X-File-Name": encodeURIComponent(response.fileName),
                    ...corsHeaders
                }
            });
        }

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });

    } catch (error) {
        console.error('Error checking file existence:', error);
        return new Response(JSON.stringify({ exists: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
        });
    }
}

/**
 * 根据存储渠道检查文件是否存在
 * @param {Object} env - 环境变量
 * @param {string} fileId - 文件ID
 * @param {string} channel - 存储渠道
 * @returns {Promise<boolean>}
 */
async function checkFileExists(env, fileId, channel) {
    // R2 存储
    if (channel === 'CloudflareR2' || channel === 'R2') {
        return await checkR2Exists(env, fileId);
    }

    // S3 存储
    if (channel === 'S3') {
        // S3 检查比较复杂，暂时返回 true（依赖数据库记录）
        return true;
    }

    // Discord 存储
    if (channel === 'Discord') {
        // Discord 文件URL会过期，难以检查，暂时返回 true
        return true;
    }

    // HuggingFace 存储
    if (channel === 'HuggingFace') {
        // 暂不检查
        return true;
    }

    // 外部链接
    if (channel === 'External') {
        return true;
    }

    // Telegram/Telegraph 存储
    if (channel === 'Telegram' || channel === 'TelegramNew' || !channel) {
        // Telegram 文件通过 TG API 获取，难以直接检查，暂时返回 true
        return true;
    }

    // 未知渠道，尝试检查 R2（可能 channel 字段缺失）
    if (env.img_r2) {
        const r2Exists = await checkR2Exists(env, fileId);
        if (r2Exists) return true;
    }

    // 默认返回 true（依赖数据库记录）
    return true;
}

/**
 * 检查 R2 中的文件是否存在
 * @param {Object} env - 环境变量
 * @param {string} fileId - 文件ID
 * @returns {Promise<boolean>}
 */
async function checkR2Exists(env, fileId) {
    if (!env.img_r2 || typeof env.img_r2.head !== 'function') {
        return false;
    }

    try {
        const r2Object = await env.img_r2.head(fileId);
        return r2Object !== null;
    } catch (error) {
        console.error('R2 head check error:', error);
        return false;
    }
}
