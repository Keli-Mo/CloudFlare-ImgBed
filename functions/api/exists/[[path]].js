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
 * 同时检查数据库记录和 R2 存储中的实际文件
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

        // 2. 如果是 R2 存储，实际检查 R2 中的文件是否存在
        const channel = imgRecord.metadata?.Channel;
        if (channel === 'CloudflareR2' || channel === 'R2') {
            // 检查 R2 配置
            if (env.img_r2 && typeof env.img_r2.head === 'function') {
                try {
                    // 使用 head 方法检查文件是否存在（不下载内容）
                    const r2Object = await env.img_r2.head(fileId);
                    if (!r2Object) {
                        // R2 中文件不存在
                        return new Response(JSON.stringify({ exists: false, error: 'File not found in R2' }), {
                            status: 404,
                            headers: { "Content-Type": "application/json", ...corsHeaders }
                        });
                    }
                } catch (r2Error) {
                    console.error('R2 check error:', r2Error);
                    // R2 检查失败，返回不存在
                    return new Response(JSON.stringify({ exists: false, error: 'R2 check failed' }), {
                        status: 404,
                        headers: { "Content-Type": "application/json", ...corsHeaders }
                    });
                }
            }
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
