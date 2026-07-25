import sys

def parse_webm(filename):
    with open(filename, 'rb') as f:
        data = f.read()
    
    print(f"Total size: {len(data)} bytes")
    # Simple search for Matroska Cluster ID (0x1F43B675)
    cluster_id = b'\x1F\x43\xB6\x75'
    
    count = 0
    idx = 0
    cluster_positions = []
    while True:
        idx = data.find(cluster_id, idx)
        if idx == -1:
            break
        cluster_positions.append(idx)
        count += 1
        idx += 4
        
    print(f"Found {count} clusters.")
    for i in range(len(cluster_positions)):
        start = cluster_positions[i]
        end = cluster_positions[i+1] if i + 1 < len(cluster_positions) else len(data)
        print(f"Cluster {i+1}: pos {start}, size {end - start} bytes")

if __name__ == '__main__':
    parse_webm(sys.argv[1])
