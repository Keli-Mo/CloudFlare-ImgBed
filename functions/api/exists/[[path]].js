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
 * 只检查数据库中是否有记录，不返回文件内容
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
        // 从数据库中检查文件记录是否存在
        const db = getDatabase(env);
        const imgRecord = await db.getWithMetadata(fileId);

        // 文件不存在
        if (!imgRecord) {
            return new Response(JSON.stringify({ exists: false }), {
                status: 404,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        // 文件存在，返回基本信息
        const response = {
            exists: true,
            fileName: imgRecord.metadata?.FileName || fileId,
            fileType: imgRecord.metadata?.FileType || null,
            channel: imgRecord.metadata?.Channel || null,
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
